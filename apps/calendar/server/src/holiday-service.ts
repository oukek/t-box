import type {
  HolidayDataset,
  HolidaySyncSettings,
  HolidayYearAdmin,
  HolidayYearSnapshot,
} from '@t-box/calendar-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { HolidayYearRow } from './holiday-entity.js'
import type { HolidayFetcher } from './holiday-provider.js'
import { randomUUID } from 'node:crypto'
import {
  calendarDayInfo,
  holidayYear,
  parseHolidayDataset,
} from '@t-box/calendar-contracts'
import { temporalDomain } from '@t-box/server-foundation/persistence/errors'
import { dayjs } from '@t-box/time-contracts'
import { ErrorCode } from './error-codes.js'
import {
  HolidayAuditEntity,
  HolidaySettingsEntity,
  HolidayYearEntity,
} from './holiday-entity.js'
import { fetchHolidayYear } from './holiday-provider.js'

const publicView = (row: HolidayYearRow): HolidayYearSnapshot => ({
  region: 'CN',
  year: row.year,
  revision: row.revision,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  data: row.published,
})
const adminView = (row: HolidayYearRow): HolidayYearAdmin => ({
  ...publicView(row),
  candidate: row.candidate,
  manual: row.manual,
  checkedAt: row.checkedAt?.toISOString() ?? null,
  lastError: row.lastError,
  updatedBy: row.updatedBy,
})
const empty = (year: number): HolidayYearRow => ({
  region: 'CN',
  year,
  revision: 0,
  published: null,
  candidate: null,
  manual: false,
  checkedAt: null,
  lastError: null,
  publishedAt: null,
  updatedAt: new Date(),
  updatedBy: null,
})
export class HolidayService {
  private readonly pending = new Map<number, Promise<void>>()
  private readonly controller = new AbortController()
  private timer?: ReturnType<typeof setInterval>
  constructor(
    private readonly source: DataSource,
    private readonly fetcher: HolidayFetcher = fetchHolidayYear,
    private readonly settingsCache?: {
      read<T>(
        scope: string,
        revision: string,
        load: () => Promise<T>,
      ): Promise<T>
    },
  ) {}

  async settings(): Promise<HolidaySyncSettings> {
    const settings = (await this.source
      .getRepository(HolidaySettingsEntity)
      .findOneBy({ region: 'CN' })) ?? { enabled: true, autoPublish: true }
    return this.settingsCache
      ? this.settingsCache.read(
          'calendar-settings',
          JSON.stringify({
            enabled: settings.enabled,
            autoPublish: settings.autoPublish,
          }),
          async () => settings,
        )
      : settings
  }

  async configure(value: unknown, actorId: string) {
    const v = value as HolidaySyncSettings
    if (
      !v ||
      typeof v.enabled !== 'boolean' ||
      typeof v.autoPublish !== 'boolean' ||
      Object.keys(v).some((k) => !['enabled', 'autoPublish'].includes(k))
    ) {
      throw ErrorCode.INVALID_SETTINGS()
    }
    await this.source.transaction(async (db) => {
      await db
        .getRepository(HolidaySettingsEntity)
        .save({ region: 'CN', enabled: v.enabled, autoPublish: v.autoPublish })
      await db.getRepository(HolidayAuditEntity).save({
        id: randomUUID(),
        year: 0,
        action: 'settings',
        actorId,
        revision: 0,
        data: v,
        createdAt: new Date(),
      })
    })
    return this.settings()
  }

  async getYear(value: unknown): Promise<HolidayYearSnapshot> {
    const year = temporalDomain(() => holidayYear(value))
    const row = await this.source
      .getRepository(HolidayYearEntity)
      .findOneBy({ region: 'CN', year })
    if (!row?.published) {
      await this.sync(year)
    } else {
      void this.sync(year).catch(() => {})
    }
    return publicView(
      (await this.source
        .getRepository(HolidayYearEntity)
        .findOneBy({ region: 'CN', year })) ?? empty(year),
    )
  }

  async dateInfo(date: string) {
    const year = Number(date.slice(0, 4))
    const years =
      year >= 1900 && year <= 2100
        ? await Promise.all(
            [year - 1, year, year + 1]
              .filter((y) => y >= 1900 && y <= 2100)
              .map((y) => this.getYear(y)),
          )
        : []
    return calendarDayInfo(date, years)
  }

  async list(): Promise<HolidayYearAdmin[]> {
    return (
      await this.source
        .getRepository(HolidayYearEntity)
        .find({ where: { region: 'CN' }, order: { year: 'DESC' } })
    ).map(adminView)
  }

  async audit(year: number) {
    return this.source
      .getRepository(HolidayAuditEntity)
      .find({ where: { year }, order: { createdAt: 'DESC' }, take: 30 })
  }

  sync(
    value: unknown,
    force = false,
    actorId: string | null = null,
  ): Promise<void> {
    const year = temporalDomain(() => holidayYear(value))
    if (this.controller.signal.aborted) {
      return Promise.resolve()
    }
    const existing = this.pending.get(year)
    if (existing) {
      return existing
    }
    const promise = this.synchronize(year, force, actorId).finally(() =>
      this.pending.delete(year),
    )
    this.pending.set(year, promise)
    return promise
  }

  private async synchronize(
    year: number,
    force: boolean,
    actorId: string | null,
  ) {
    const config = await this.settings()
    if (!force && !config.enabled) {
      return
    }
    // Connection-scoped MySQL lock prevents duplicate network sync across API workers.
    const runner = this.source.createQueryRunner()
    await runner.connect()
    const lock = `calendar:holidays:CN:${year}`
    let acquired = false
    try {
      // native-sql: MySQL advisory lock must use this exact connection
      const [result] = await runner.query('SELECT GET_LOCK(?,0) AS acquired', [
        lock,
      ])
      acquired = Number(result.acquired) === 1
      if (!acquired) {
        return
      }
      let row = await runner.manager
        .getRepository(HolidayYearEntity)
        .findOneBy({ region: 'CN', year })
      if (
        !force &&
        row?.checkedAt &&
        Date.now() - row.checkedAt.getTime() <
          (row.lastError ? 3600000 : 24 * 3600000)
      ) {
        return
      }
      let dataset: HolidayDataset | null = null
      let failure: string | null = null
      try {
        dataset = await this.fetcher(year, this.controller.signal)
      } catch (cause) {
        failure =
          cause instanceof Error
            ? cause.message.slice(0, 400)
            : '节假日同步失败'
      }
      if (this.controller.signal.aborted) {
        return
      }
      const autoPublish = (await this.settings()).autoPublish
      await runner.manager.transaction(async (db) => {
        const repo = db.getRepository(HolidayYearEntity)
        row =
          (await repo.findOne({
            where: { region: 'CN', year },
            lock: { mode: 'pessimistic_write' },
          })) ?? empty(year)
        row.checkedAt = new Date()
        row.lastError =
          failure ?? (!dataset ? '年度安排尚未公布或数据源暂未收录' : null)
        if (
          dataset &&
          !row.manual &&
          JSON.stringify(row.candidate) !== JSON.stringify(dataset)
        ) {
          row.candidate = dataset
          row.revision++
          row.updatedAt = new Date()
          row.updatedBy = actorId
          if (autoPublish) {
            row.published = dataset
            row.publishedAt = new Date()
          }
          await this.record(db, row, 'sync', actorId)
        } else if (
          dataset &&
          !row.manual &&
          autoPublish &&
          JSON.stringify(row.published) !== JSON.stringify(dataset)
        ) {
          row.published = dataset
          row.publishedAt = new Date()
          row.revision++
          row.updatedAt = new Date()
          await this.record(db, row, 'auto_publish', actorId)
        }
        await repo.save(row)
      })
    } finally {
      if (acquired) {
        // native-sql: MySQL advisory lock must use this exact connection
        await runner.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {})
      }
      await runner.release()
    }
  }

  private async record(
    db: EntityManager,
    row: HolidayYearRow,
    action: string,
    actorId: string | null,
  ) {
    await db.getRepository(HolidayAuditEntity).save({
      id: randomUUID(),
      year: row.year,
      action,
      actorId,
      revision: row.revision,
      data: {
        published: row.published,
        candidate: row.candidate,
        manual: row.manual,
      },
      createdAt: new Date(),
    })
  }

  async edit(
    value: unknown,
    revision: unknown,
    input: unknown,
    action: 'draft' | 'publish' | 'automatic',
    actorId: string,
  ) {
    const year = temporalDomain(() => holidayYear(value))
    if (!Number.isInteger(revision) || Number(revision) < 0) {
      throw ErrorCode.INVALID_REVISION()
    }
    const dataset =
      action === 'draft'
        ? temporalDomain(() => parseHolidayDataset(input))
        : null
    if (dataset && dataset.year !== year) {
      throw ErrorCode.INVALID_YEAR()
    }
    return this.source.transaction(async (db) => {
      const repo = db.getRepository(HolidayYearEntity)
      const row =
        (await repo.findOne({
          where: { region: 'CN', year },
          lock: { mode: 'pessimistic_write' },
        })) ?? empty(year)
      if (row.revision !== revision) {
        throw ErrorCode.HOLIDAY_REVISION_CONFLICT()
      }
      if (action === 'draft') {
        row.candidate = dataset
        row.manual = true
      }
      if (action === 'publish') {
        row.published = temporalDomain(() =>
          parseHolidayDataset(row.candidate, true),
        )
        row.publishedAt = new Date()
        row.manual = true
      }
      if (action === 'automatic') {
        row.manual = false
        row.checkedAt = null
      }
      row.revision++
      row.updatedAt = new Date()
      row.updatedBy = actorId
      await repo.save(row)
      await this.record(db, row, action, actorId)
      return adminView(row)
    })
  }

  start(report: (error: unknown) => void = () => {}) {
    if (this.timer) {
      return
    }
    const run = async () => {
      const year = dayjs().year()
      await Promise.all(
        [year - 1, year, year + 1]
          .filter((y) => y >= 1900 && y <= 2100)
          .map((y) => this.sync(y).catch(report)),
      )
    }
    void run().catch(report)
    this.timer = setInterval(() => {
      void run().catch(report)
    }, 6 * 3600000)
    this.timer.unref()
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = undefined
    this.controller.abort()
    await Promise.allSettled(this.pending.values())
  }
}
