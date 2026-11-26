import type { DataSource, EntityManager } from 'typeorm'
import type { ReleaseChannel } from '../db/records/system-versions.js'
import { createHash, randomUUID } from 'node:crypto'
import { compareSystemVersions, nextSystemVersion, parseSystemVersion } from '@t-box/app-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { ChannelVersionReservation, SystemDesktopCandidate, SystemVersionCursor, SystemVersionReservation, SystemWebCandidate } from '../db/records/system-versions.js'
import { ErrorCode } from '../error-codes.js'

function selection(value: unknown, field: string) {
  if (value === undefined) {
    return null
  }
  if (typeof value === 'string' && ['patch', 'minor', 'major'].includes(value)) {
    return { mode: value as 'patch' | 'minor' | 'major' }
  }
  try {
    parseSystemVersion(value)
  } catch {
    return invalid(field, '请选择 patch、minor、major 或填写完整目标版本')
  }
  if (typeof value !== 'string' || value.length > 96) {
    return invalid(field, '版本长度超限')
  }
  return { mode: 'manual' as const, version: value }
}

export async function findChannelReservation(db: EntityManager, build: string, channel: ReleaseChannel, lock = false) {
  const options = lock ? { lock: { mode: 'pessimistic_write' as const } } : {}
  return await db.findOne(ChannelVersionReservation, { where: [{ build, channel }, { build, channel: 'shared' }], ...options }) ??
    await db.findOne(SystemVersionReservation, { where: { build }, ...options })
}

export async function reserveSystemVersions(source: DataSource, input: unknown) {
  const b = input as Record<string, unknown> | null
  if (!b || typeof b.batch !== 'string' || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+\/[1-9]\d*$/.test(b.batch) || b.batch.length > 160 ||
    typeof b.commit !== 'string' || !/^[a-f0-9]{40}$/.test(b.commit) ||
    (b.channel !== undefined && b.channel !== 'desktop' && b.channel !== 'web' && b.channel !== 'macos' && b.channel !== 'shared') ||
    Object.keys(b).some((key) => !['batch', 'commit', 'ui', 'core', 'channel'].includes(key))) {
    return invalid('batch', '无效的系统构建来源')
  }
  const channel = b.channel === 'shared' || b.channel === 'macos' || b.channel === 'web' ? b.channel : undefined
  const desktop = b.channel === 'desktop' || channel === 'macos' || channel === 'shared'
  if (channel === 'web' && b.core !== undefined) {
    return invalid('core', '网页渠道只支持界面版本')
  }
  if (channel === 'shared' && !b.ui) {
    return invalid('ui', '主界面构建需要 UI 版本')
  }
  const batch = b.batch
  const ui = selection(b.ui, 'ui')
  const core = selection(b.core, 'core')
  if (!ui && !core) {
    return invalid('ui', '请选择至少一个构建组件')
  }
  const hash = createHash('sha256').update(JSON.stringify(b.channel ? [b.commit, ui, core, b.channel] : [b.commit, ui, core])).digest('hex')
  return source.transaction(async (db) => {
    // native-sql: ON DUPLICATE KEY UPDATE takes the exclusive singleton lock even on the first concurrent reservations.
    await db.query('INSERT INTO system_version_cursor(id,ui,core) VALUES(1,\'0.1.0\',\'0.0.0\') ON DUPLICATE KEY UPDATE id=1')
    const legacy = await db.findOneByOrFail(SystemVersionCursor, { id: 1 })
    const table = channel ? ChannelVersionReservation : SystemVersionReservation
    const id = channel === 'web' ? 2 : desktop && channel ? 3 : 1
    // Each channel starts at the last shared reservation. Old in-flight batches retain their IDs.
    const heads = id === 1 ? legacy : await db.findOneBy(SystemVersionCursor, { id }) ?? { ...legacy, id }
    if (channel === 'shared') {
      const webHead = await db.findOneBy(SystemVersionCursor, { id: 2 })
      if (webHead && compareSystemVersions(webHead.ui, heads.ui) > 0) {
        heads.ui = webHead.ui
      }
    }
    if (ui && channel !== 'shared' && await db.existsBy(ChannelVersionReservation, { channel: 'shared' })) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('请使用主界面构建工作流')
    }
    const existing = await db.findOneBy(table, { batch })
    if (!channel && !existing && await db.exists(ChannelVersionReservation)) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('发布渠道已拆分，请从最新分支运行对应的发布工作流')
    }
    if (existing) {
      if (existing.request_hash !== hash || (ui && heads.ui !== existing.ui) || (core && heads.core !== existing.core)) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('构建批次参数变化或已被更新的批次取代，请发起新构建')
      }
      return { build: existing.build, ui: existing.ui, core: existing.core }
    }
    // An explicit version at the current head requests replacement of its unpublished build.
    const match = ui?.version === heads.ui ? { ui: heads.ui } : core?.version === heads.core ? { core: heads.core } : null
    const previous = match && await db.findOne(table, { where: { ...match, ...(channel && { channel }) }, lock: { mode: 'pessimistic_write' } })
    if (previous) {
      const sameRepo = previous.batch.slice(0, previous.batch.lastIndexOf('/')) === batch.slice(0, batch.lastIndexOf('/'))
      if (!sameRepo || Boolean(ui) !== Boolean(previous.ui) || Boolean(core) !== Boolean(previous.core) ||
        (previous.ui && previous.ui !== heads.ui) || (previous.core && previous.core !== heads.core)) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('覆盖时请选择原构建的组件和当前预留版本')
      }
      const where = { build: previous.build }
      const web = await db.findOne(SystemWebCandidate, { where, lock: { mode: 'pessimistic_write' } })
      const client = await db.findOneBy(SystemDesktopCandidate, where)
      if ((web && web.state !== 'pending') || (client && client.state !== 'pending')) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('该版本已经开始发布，请使用更高版本')
      }
      if (web) {
        await db.delete(SystemWebCandidate, where)
      }
      if (client) {
        await db.delete(SystemDesktopCandidate, where)
      }
      // Keep the old batch as a tombstone so a delayed retry cannot reclaim the version.
      await db.update(table, where, { ui: null, core: null })
    }
    function allocate(field: 'ui' | 'core', request: typeof ui) {
      if (!request) {
        return null
      }
      if (previous?.[field] && (request.mode !== 'manual' || request.version === previous[field])) {
        return previous[field]
      }
      if (desktop && field === 'core' && request.version && compareSystemVersions(request.version, '1.0.0') < 0) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('桌面核心版本最低为 1.0.0')
      }
      let next: string
      try {
        const minimum = desktop && field === 'core' && request.mode !== 'manual' && compareSystemVersions(heads.core, '1.0.0') < 0 ? '1.0.0' : heads[field]
        next = nextSystemVersion(minimum, request.mode, request.version)
      } catch {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('目标版本必须高于该组件已预留的 ' + heads[field])
      }
      if (next.length > 96) {
        return invalid(field, '版本长度超限')
      }
      heads[field] = next
      return next
    }
    const result = { build: randomUUID(), ui: allocate('ui', ui), core: allocate('core', core) }
    await db.insert(table, { ...result, batch, request_hash: hash, ...(channel && { channel }) })
    await db.save(SystemVersionCursor, heads)
    return result
  })
}
