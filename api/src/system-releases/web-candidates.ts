import type { DataSource } from 'typeorm'
import type { WebStorage } from './web-storage.js'
import { compareSystemVersions } from '@t-box/app-contracts'
import { In } from 'typeorm'
import { SystemVersionReservation, SystemWebCandidate, SystemWebReleaseNotes } from '../db/records/system-versions.js'
import { ErrorCode } from '../error-codes.js'
import { publicationNotes } from './release-notes.js'

import { readCandidate, webStorage } from './web-storage.js'

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
export async function registerWebCandidate(source: DataSource, input: unknown, storage?: WebStorage) {
  const { build, digest } = (input ?? {}) as Record<string, unknown>
  if (typeof build !== 'string' || !uuid.test(build) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
    throw ErrorCode.INVALID_APP_BUILD('候选构建编号或摘要无效')
  }
  const reservation = await source.manager.findOneBy(SystemVersionReservation, { build })
  if (!reservation?.ui) {
    throw ErrorCode.INVALID_APP_BUILD('需要已预留的主界面版本')
  }
  const version = reservation.ui
  const { files, total } = await readCandidate(storage ?? webStorage(), build, digest, version)
  return source.transaction(async (db) => {
    const currentReservation = await db.findOneOrFail(SystemVersionReservation, { where: { build }, lock: { mode: 'pessimistic_write' } })
    if (currentReservation.ui !== version) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('该构建已被同版本的新候选取代')
    }
    const existing = await db.findOneBy(SystemWebCandidate, { build })
    if (existing) {
      if (existing.digest !== digest) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('该版本已经登记其他产物，请申请新版本')
      }
      return existing
    }
    return db.save(SystemWebCandidate, { build, digest, version, files: files.size, bytes: total, state: 'pending', actor: null })
  })
}

export async function listWebCandidates(source: DataSource) {
  const db = source.getRepository(SystemWebCandidate)
  const [current, interrupted, candidates] = await Promise.all([
    db.findOneBy({ state: 'live' }),
    db.findOneBy({ state: In(['publishing', 'failed']) }),
    db.find({ order: { createdAt: 'DESC', build: 'ASC' }, take: 100 }),
  ])
  if (interrupted && !candidates.some((row) => row.build === interrupted.build)) {
    candidates.unshift(interrupted)
  }
  if (interrupted) {
    const details = await source.manager.findOneBy(SystemWebReleaseNotes, { build: interrupted.build })
    const row = candidates.find((item) => item.build === interrupted.build)
    if (row && details) {
      Object.assign(row, { notes: details.notes })
    }
  }
  return { current, interrupted, candidates }
}

export async function promoteWebCandidate(source: DataSource, build: string, expected: unknown, actor: string, notesInput: unknown, storage?: WebStorage) {
  if (!uuid.test(build) || (expected !== null && (typeof expected !== 'string' || !uuid.test(expected)))) {
    throw ErrorCode.INVALID_APP_BUILD('请刷新列表并重新核对线上版本')
  }
  const runner = source.createQueryRunner()
  await runner.connect()
  const db = runner.manager
  let locked = false
  try {
    // native-sql: connection-scoped lock serializes OSS writes across all API instances, including retries.
    const [lock] = await runner.query('SELECT GET_LOCK(\'tbox_web_promotion\',0) AS acquired')
    locked = Number(lock.acquired) === 1
    if (!locked) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('已有版本正在发布，请稍后刷新')
    }
    const candidate = await db.findOneBy(SystemWebCandidate, { build })
    if (!candidate) {
      throw ErrorCode.INVALID_APP_BUILD('候选版本不存在')
    }
    if (candidate.state === 'live') {
      return candidate
    }
    const current = await db.findOneBy(SystemWebCandidate, { state: 'live' })
    if ((current?.build ?? null) !== expected || (current && compareSystemVersions(candidate.version, current.version) <= 0)) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('线上版本已变化或高于候选版本，请刷新后重新核对')
    }
    const interrupted = await db.findOneBy(SystemWebCandidate, { state: In(['publishing', 'failed']) })
    if (interrupted && interrupted.build !== build) {
      throw ErrorCode.SYSTEM_VERSION_CONFLICT('请先恢复未完成的发布')
    }
    const store = storage ?? webStorage()
    const { files } = await readCandidate(store, build, candidate.digest, candidate.version)
    const previous = candidate.state !== 'pending' && await db.findOneBy(SystemWebReleaseNotes, { build })
    const notes = previous ? previous.notes : publicationNotes(notesInput)
    await db.transaction(async (tx) => {
      const claimed = await tx.update(SystemWebCandidate, { build, state: candidate.state }, { state: 'publishing', actor })
      if (!claimed.affected) {
        throw ErrorCode.SYSTEM_VERSION_CONFLICT('候选已失效，请刷新列表')
      }
      await tx.save(SystemWebReleaseNotes, { build, notes })
    })
    files.set('web-version.json', Buffer.from(JSON.stringify({ build, version: candidate.version, notes }) + '\n'))
    try {
      const last = ['index.html', 'tbox-offline-sw.js', 'web-version.json']
      const ordered = [...files.keys()].sort((a, b) => last.indexOf(a) - last.indexOf(b))
      for (const path of ordered) {
        await store.write(path, files.get(path)!)
      }
      await db.transaction(async (tx) => {
        if (current) {
          await tx.update(SystemWebCandidate, { build: current.build }, { state: 'archived' })
        }
        await tx.update(SystemWebCandidate, { build }, { state: 'live' })
      })
    } catch {
      await db.update(SystemWebCandidate, { build }, { state: 'failed' })
      throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('发布中断，请检查主站 OSS 权限和连接后重试本版本')
    }
    return { ...candidate, state: 'live', actor }
  } finally {
    try {
      if (locked) {
        // native-sql: release the advisory lock on its owning connection.
        await runner.query('SELECT RELEASE_LOCK(\'tbox_web_promotion\')')
      }
    } finally {
      await runner.release()
    }
  }
}
