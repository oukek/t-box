import type { DataSource } from 'typeorm'
import type { DesktopArtifact, DesktopCandidate } from '../db/records/system-versions.js'
import { compareSystemVersions, parseSystemVersion } from '@t-box/app-contracts'
import { SystemDesktopCandidate, SystemVersionCursor, SystemVersionReservation } from '../db/records/system-versions.js'
import { ErrorCode } from '../error-codes.js'
import { checkArtifact, desktopStorage } from './desktop-artifacts.js'

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const invalid = () => ErrorCode.INVALID_APP_BUILD('桌面候选信息无效，首次发布需要同时构建界面和核心')
function artifact(build: string, version: string | null, raw: unknown, previous?: DesktopArtifact): DesktopArtifact {
  if (!version) {
    if (raw != null || !previous) {
      throw invalid()
    }
    return previous
  }
  const { digest, signature } = (raw ?? {}) as Partial<DesktopArtifact>
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || typeof signature !== 'string' || !signature.length || signature.length > 4096) {
    throw invalid()
  }
  if (previous && compareSystemVersions(version, previous.version) <= 0) {
    throw ErrorCode.SYSTEM_VERSION_CONFLICT('目标版本必须高于线上版本')
  }
  return { build, version, digest, signature }
}

export async function listDesktopCandidates(db: DataSource) {
  const repo = db.getRepository(SystemDesktopCandidate)
  const [current, candidates] = await Promise.all([repo.findOneBy({ state: 'live' }), repo.find({ order: { createdAt: 'DESC', build: 'ASC' }, take: 100 })])
  return { current, candidates }
}
async function verifyPair(db: DataSource, row: Pick<DesktopCandidate, 'build' | 'ui' | 'core'>, store: ReturnType<typeof desktopStorage>) {
  const embedded = row.core.build === row.build ? row.ui : (await db.manager.findOneByOrFail(SystemDesktopCandidate, { build: row.core.build })).ui
  return Promise.all([checkArtifact(store, 'ui', row.ui, row.ui), checkArtifact(store, 'core', row.core, embedded)])
}
export async function registerDesktop(db: DataSource, raw: unknown, store = desktopStorage()) {
  const { build, base, notes, ui, core } = (raw ?? {}) as Record<string, unknown>
  if (typeof build !== 'string' || !uuid.test(build) || (base !== null && (typeof base !== 'string' || !uuid.test(base))) || typeof notes !== 'string' || notes.length > 1000) {
    throw invalid()
  }
  const r = await db.manager.findOneBy(SystemVersionReservation, { build })
  if (!r) {
    throw invalid()
  }
  const previous = base && await db.manager.findOneBy(SystemDesktopCandidate, { build: base })
  if (base && !previous) {
    throw invalid()
  }
  const next = { build, base, notes, ui: artifact(build, r.ui, ui, previous ? previous.ui : undefined), core: artifact(build, r.core, core, previous ? previous.core : undefined), kind: r.ui && r.core ? 'both' as const : r.ui ? 'ui' as const : 'core' as const }
  const [uiBytes, coreBytes] = await verifyPair(db, next, store)
  next.ui = { ...next.ui, bytes: uiBytes }
  next.core = { ...next.core, bytes: coreBytes }
  return db.transaction(async (tx) => {
    await tx.findOneOrFail(SystemVersionCursor, { where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
    const existing = await tx.findOneBy(SystemDesktopCandidate, { build })
    if (existing) {
      if (existing.base !== base || existing.notes !== notes || existing.ui.digest !== next.ui.digest || existing.core.digest !== next.core.digest) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('该版本已绑定其他候选')
      }
      return existing
    }
    const live = await tx.findOneBy(SystemDesktopCandidate, { state: 'live' })
    if ((live?.build ?? null) !== base) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('线上组合已变化，请重新构建')
    }
    return tx.save(SystemDesktopCandidate, { ...next, actor: null, state: 'pending' })
  })
}
export async function publishDesktop(db: DataSource, build: string, expected: unknown, actor: string, store = desktopStorage()) {
  const row = uuid.test(build) && await db.manager.findOneBy(SystemDesktopCandidate, { build })
  if (!row) {
    throw invalid()
  }
  if (row.state === 'live') {
    return row
  }
  if (row.base !== expected || row.state !== 'pending') {
    throw ErrorCode.SYSTEM_VERSION_CONFLICT('候选基线不匹配')
  }
  await verifyPair(db, row, store)
  return db.transaction(async (tx) => {
    await tx.findOneOrFail(SystemVersionCursor, { where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
    const live = await tx.findOneBy(SystemDesktopCandidate, { state: 'live' })
    if (live?.build === build) {
      return live
    }
    if ((live?.build ?? null) !== expected) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('线上版本已变化，请刷新列表')
    }
    if (live) {
      await tx.update(SystemDesktopCandidate, { build: live.build }, { state: 'archived' })
    }
    await tx.update(SystemDesktopCandidate, { build }, { state: 'live', actor })
    return { ...row, state: 'live', actor }
  })
}
export async function desktopPlan(db: DataSource, query: Record<string, unknown>, store?: ReturnType<typeof desktopStorage>) {
  if (query.platform !== 'macos' || query.arch !== 'aarch64') {
    return null
  }
  const { ui, core } = query
  if (typeof ui !== 'string' || typeof core !== 'string' || ui.length > 96 || core.length > 96) {
    throw invalid()
  }
  try {
    parseSystemVersion(ui)
    parseSystemVersion(core)
  } catch {
    throw invalid()
  }
  const row = await db.manager.findOneBy(SystemDesktopCandidate, { state: 'live' })
  if (!row) {
    return null
  }
  const u = compareSystemVersions(row.ui.version, ui)
  const c = compareSystemVersions(row.core.version, core)
  if (u < 0 || c < 0 || (!u && !c)) {
    return null
  }
  const base = process.env.TBOX_DESKTOP_API_BASE || 'https://api.tboxos.cn/api/v1'
  return {
    id: row.build,
    notes: row.notes,
    ui: u ? { bytes: row.ui.bytes, version: row.ui.version, digest: row.ui.digest, signature: row.ui.signature, url: await (store ?? desktopStorage()).url('ui', row.ui) } : null,
    core: c ? { bytes: row.core.bytes, version: row.core.version, endpoint: base + '/system-updates/' + row.build + '/core' } : null,
  }
}
