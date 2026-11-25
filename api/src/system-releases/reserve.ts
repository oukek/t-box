import type { DataSource } from 'typeorm'
import { createHash, randomUUID } from 'node:crypto'
import { compareSystemVersions, nextSystemVersion, parseSystemVersion } from '@t-box/app-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { SystemVersionCursor, SystemVersionReservation } from '../db/records/system-versions.js'
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

export async function reserveSystemVersions(source: DataSource, input: unknown) {
  const b = input as Record<string, unknown> | null
  if (!b || typeof b.batch !== 'string' || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+\/[1-9]\d*$/.test(b.batch) || b.batch.length > 160 ||
    typeof b.commit !== 'string' || !/^[a-f0-9]{40}$/.test(b.commit) ||
    (b.channel !== undefined && b.channel !== 'desktop') ||
    Object.keys(b).some((key) => !['batch', 'commit', 'ui', 'core', 'channel'].includes(key))) {
    return invalid('batch', '无效的系统构建来源')
  }
  const desktop = b.channel === 'desktop'
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
    const heads = await db.findOneByOrFail(SystemVersionCursor, { id: 1 })
    const existing = await db.findOneBy(SystemVersionReservation, { batch })
    if (existing) {
      if (existing.request_hash !== hash || (ui && heads.ui !== existing.ui) || (core && heads.core !== existing.core)) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('构建批次参数变化或已被更新的批次取代，请发起新构建')
      }
      return { build: existing.build, ui: existing.ui, core: existing.core }
    }
    function allocate(field: 'ui' | 'core', request: typeof ui) {
      if (!request) {
        return null
      }
      let next: string
      try {
        const minimum = desktop && field === 'core' && compareSystemVersions(heads.core, '1.0.0') < 0 ? '1.0.0' : heads[field]
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
    await db.insert(SystemVersionReservation, { ...result, batch, request_hash: hash })
    await db.save(SystemVersionCursor, heads)
    return result
  })
}
