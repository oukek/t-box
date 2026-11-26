import type { DataSource, EntityManager } from 'typeorm'
import type { DesktopArtifact, DesktopCandidate, DesktopCore } from '../db/records/system-versions.js'
import { compareSystemVersions, parseSystemVersion } from '@t-box/app-contracts'
import { In } from 'typeorm'
import { ChannelVersionReservation, SystemDesktopCandidate, SystemVersionCursor, SystemWebCandidate } from '../db/records/system-versions.js'
import { ErrorCode } from '../error-codes.js'
import { checkArtifact, desktopStorage, installer, isMacArch, updateArchive } from './desktop-artifacts.js'

import { publicationNotes } from './release-notes.js'
import { findChannelReservation } from './reserve.js'

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

function sameCore(a: DesktopCore, b: DesktopCore) {
  return a.digest === b.digest &&
    a.distribution?.intel.digest === b.distribution?.intel.digest &&
    a.distribution?.installers.aarch64.digest === b.distribution?.installers.aarch64.digest &&
    a.distribution?.installers.x86_64.digest === b.distribution?.installers.x86_64.digest
}

export async function listDesktopCandidates(db: DataSource) {
  const repo = db.getRepository(SystemDesktopCandidate)
  const [current, candidates] = await Promise.all([repo.findOneBy({ state: 'live' }), repo.find({ order: { createdAt: 'DESC', build: 'ASC' }, take: 100 })])
  const reservations = await db.manager.findBy(ChannelVersionReservation, { channel: 'shared', build: In(candidates.map((row) => row.build)) })
  const shared = new Set(reservations.map((row) => row.build))
  return { current, candidates: candidates.map((row) => ({ ...row, shared: shared.has(row.build) })) }
}
export async function desktopTrialUrl(db: DataSource, build: string, store?: ReturnType<typeof desktopStorage>, arch: unknown = 'aarch64') {
  const candidate = uuid.test(build) && await db.manager.findOneBy(SystemDesktopCandidate, { build, state: 'pending' })
  if (!candidate || candidate.core.build !== build) {
    throw ErrorCode.INVALID_APP_BUILD('该构建没有可下载的待确认桌面安装包，请刷新列表')
  }
  const file = isMacArch(arch) && installer(candidate.core, arch)
  if (!file) {
    throw invalid()
  }
  const filename = `Tbox-trial-core-${candidate.core.version}-ui-${candidate.ui.version}-${build.slice(0, 8)}-${arch}.${file.extension}`
  return (store ?? desktopStorage()).url(file.kind, file.item, filename)
}
export async function verifyPair(db: DataSource, row: Pick<DesktopCandidate, 'build' | 'ui' | 'core'>, store: ReturnType<typeof desktopStorage>) {
  const embedded = row.core.build === row.build ? row.ui : (await db.manager.findOneByOrFail(SystemDesktopCandidate, { build: row.core.build })).ui
  const distribution = row.core.distribution
  if (distribution) {
    distribution.intel.bytes = await checkArtifact(store, 'core', distribution.intel, embedded, 'x86_64')
    for (const arch of ['aarch64', 'x86_64'] as const) {
      await checkArtifact(store, 'dmg', distribution.installers[arch], embedded, arch)
    }
  }
  return Promise.all([checkArtifact(store, 'ui', row.ui, row.ui), checkArtifact(store, 'core', row.core, embedded)])
}
export async function registerDesktop(db: DataSource, raw: unknown, store = desktopStorage()) {
  const { build, base, notes = '', ui, core } = (raw ?? {}) as Record<string, unknown>
  if (typeof build !== 'string' || !uuid.test(build) || (base !== null && (typeof base !== 'string' || !uuid.test(base))) || typeof notes !== 'string' || notes.length > 1000) {
    throw invalid()
  }
  const r = await findChannelReservation(db.manager, build, 'macos')
  if (!r) {
    throw invalid()
  }
  const previous = base && await db.manager.findOneBy(SystemDesktopCandidate, { build: base })
  if (base && !previous) {
    throw invalid()
  }
  const next: Pick<DesktopCandidate, 'build' | 'base' | 'notes' | 'ui' | 'core' | 'kind'> = { build, base, notes, ui: artifact(build, r.ui, ui, previous ? previous.ui : undefined), core: artifact(build, r.core, core, previous ? previous.core : undefined), kind: r.ui && r.core ? 'both' as const : r.ui ? 'ui' as const : 'core' as const }
  const distribution = (core as Partial<DesktopCore> | undefined)?.distribution
  if (r.core && previous && previous.core.distribution && !distribution) {
    throw ErrorCode.INVALID_APP_BUILD('该核心版本需要同时提供两种芯片的更新包和安装镜像')
  }
  if (distribution !== undefined) {
    if (!r.core || !distribution?.installers) {
      throw invalid()
    }
    const intel = artifact(build, r.core, distribution.intel)
    const installers = { aarch64: artifact(build, r.core, distribution.installers.aarch64), x86_64: artifact(build, r.core, distribution.installers.x86_64) }
    if (installers.aarch64.digest === installers.x86_64.digest) {
      throw invalid()
    }
    next.core.distribution = { intel, installers }
  }
  const [uiBytes, coreBytes] = await verifyPair(db, next, store)
  next.ui = { ...next.ui, bytes: uiBytes }
  next.core = { ...next.core, bytes: coreBytes }
  return db.transaction(async (tx) => {
    await tx.findOneOrFail(SystemVersionCursor, { where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
    const reservation = await findChannelReservation(tx, build, 'macos')
    if (!reservation || (!reservation.ui && !reservation.core)) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('该构建已被同版本的新候选取代')
    }
    const existing = await tx.findOneBy(SystemDesktopCandidate, { build })
    if (existing) {
      if (existing.base !== base || (existing.state === 'pending' && existing.notes !== notes) || existing.ui.digest !== next.ui.digest || !sameCore(existing.core, next.core)) {
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
export async function publishDesktop(db: DataSource, build: string, expected: unknown, actor: string, notesInput: unknown, store = desktopStorage()) {
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
  const notes = publicationNotes(notesInput)
  await verifyPair(db, row, store)
  return db.transaction(async (tx) => {
    await tx.findOneOrFail(SystemVersionCursor, { where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
    if (await tx.existsBy(SystemWebCandidate, { state: In(['publishing', 'failed']) })) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('请先恢复正在发布的主界面')
    }
    const reservation = await findChannelReservation(tx, build, 'macos')
    if (reservation?.channel === 'shared' || (row.kind !== 'core' && await tx.existsBy(ChannelVersionReservation, { channel: 'shared' }))) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('请在主界面页统一发布网页、PWA 和 Mac')
    }
    return activateDesktop(tx, row, actor, notes)
  })
}
export async function activateDesktop(tx: EntityManager, row: DesktopCandidate, actor: string, notes: string) {
  const { build, base: expected } = row
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
  const updated = await tx.update(SystemDesktopCandidate, { build, state: 'pending' }, { state: 'live', actor, notes })
  if (!updated.affected) {
    throw ErrorCode.SYSTEM_VERSION_CONFLICT('候选已失效，请刷新列表')
  }
  return { ...row, state: 'live', actor, notes }
}
export async function desktopPlan(db: DataSource, query: Record<string, unknown>, store?: ReturnType<typeof desktopStorage>) {
  if (query.platform !== 'macos' || !isMacArch(query.arch)) {
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
  const archive = row && updateArchive(row.core, query.arch)
  if (!row || !archive) {
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
    core: c ? { bytes: archive.bytes, version: row.core.version, endpoint: base + '/system-updates/' + row.build + '/core?arch=' + query.arch } : null,
  }
}
