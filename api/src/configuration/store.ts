import type {
  ConfigurationDefinition,
  ConfigurationHistory,
  ConfigurationSnapshot,
  ConfigurationValue,
  ConfigurationView,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { isDeepStrictEqual } from 'node:util'
import { jsonDocument } from '@t-box/server-foundation/persistence/columns'
import { isoTime } from '@t-box/server-foundation/time'
import {
  PlatformConfigurationEntity,
  PlatformConfigurationHistoryEntity,
  PlatformConfigurationStateEntity,
} from '../db/records/configuration-entities.js'
import { ErrorCode } from '../error-codes.js'
import { ConfigurationCache } from './cache.js'

const decode = (value: unknown) =>
  typeof value === 'string' ? JSON.parse(value) : value
export function validateConfiguration(
  def: ConfigurationDefinition,
  value: unknown,
): ConfigurationValue {
  const valid =
    def.type === 'number'
      ? typeof value === 'number' &&
      Number.isFinite(value) &&
      (def.integer === false || Number.isSafeInteger(value)) &&
      value >= (def.min ?? 0) &&
      value <= (def.max ?? Number.MAX_SAFE_INTEGER)
      : def.type === 'boolean'
        ? typeof value === 'boolean'
        : typeof value === 'string' &&
          value.length <= (def.maxLength ?? 12000) &&
          (def.type !== 'select' || def.options?.includes(value))
  if (!valid) {
    throw ErrorCode.INVALID_CONFIGURATION(`${def.title}的值或范围不正确`)
  }
  if (def.type === 'text' && typeof value === 'string' && !value.trim()) {
    throw ErrorCode.INVALID_CONFIGURATION(`${def.title}不能为空`)
  }
  return value as ConfigurationValue
}
export class ConfigurationStore {
  private readonly definitions = new Map<string, ConfigurationDefinition>()
  constructor(
    readonly source: DataSource,
    readonly cache = new ConfigurationCache(),
  ) {}

  /** Platform AI configuration only; applications own their contracts and settings. */
  async register(definitions: ConfigurationDefinition[]) {
    for (const def of definitions) {
      if (!/^[\w.-]{1,190}$/.test(def.key) || def.key.startsWith('apps.')) {
        throw ErrorCode.INTERNAL_INVALID_CONFIGURATION_KEY()
      }
      validateConfiguration(def, def.defaultValue)
      this.definitions.set(def.key, structuredClone(def))
    }
    await this.source.transaction(async (db) => {
      await db.getRepository(PlatformConfigurationStateEntity).find({
        select: { revision: true },
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      })
      let changed = false
      for (const def of definitions) {
        const existing = await db
          .getRepository(PlatformConfigurationEntity)
          .findOne({
            select: { definition_json: true },
            where: { config_key: def.key },
          })
        if (
          existing &&
          isDeepStrictEqual(decode(existing.definition_json), def)
        ) {
          continue
        }
        changed = true
        await db
          .createQueryBuilder()
          .insert()
          .into('platform_configurations')
          .values({
            config_key: def.key,
            definition_json: () => ':p1',
            value_json: () => ':p2',
          })
          .updateEntity(false)
          .orIgnore()
          .setParameters({
            p1: JSON.stringify(def),
            p2: JSON.stringify(def.defaultValue),
          })
          .execute()
        await db
          .getRepository(PlatformConfigurationEntity)
          .update({ config_key: def.key }, { definition_json: def })
        await db
          .createQueryBuilder()
          .insert()
          .into('platform_configuration_history')
          .values({
            config_key: def.key,
            revision: 0,
            value_json: () => ':p1',
            note: '平台默认配置',
          })
          .updateEntity(false)
          .orIgnore()
          .setParameters({ p1: JSON.stringify(def.defaultValue) })
          .execute()
      }
      // Metadata/default registration changes the catalog across processes as well.
      if (changed) {
        await db
          .getRepository(PlatformConfigurationStateEntity)
          .update({ id: 1 }, { revision: () => 'revision+1' })
      }
    })
  }

  async snapshot(): Promise<ConfigurationSnapshot> {
    const state = await this.source
      .getRepository(PlatformConfigurationStateEntity)
      .findOne({ select: { revision: true }, where: { id: 1 } })
    if (!state) {
      throw ErrorCode.SCHEMA_REQUIRED('请先初始化配置数据库')
    }
    const revision = Number(state.revision)
    const raw = await this.cache.read<ConfigurationSnapshot>(
      'platform',
      revision,
      async () => {
        const rows = await this.source
          .createQueryBuilder()
          .select(
            's.revision,c.config_key,CAST(c.value_json AS CHAR) AS value_json',
          )
          .from('platform_configuration_state', 's')
          .leftJoin(
            'platform_configurations',
            'c',
            'c.config_key NOT LIKE \'apps.%\'',
          )
          .where('s.id=1')
          .getRawMany()
        return {
          revision: Number(rows[0].revision),
          values: Object.fromEntries(
            rows
              .filter((r: { config_key: string }) => r.config_key)
              .map((r: { config_key: string, value_json: unknown }) => [
                r.config_key,
                decode(r.value_json),
              ]),
          ),
        }
      },
    )
    // A concurrent publication during a cache miss must not be filed under the preceding revision.
    if (raw.revision !== revision) {
      return this.snapshot()
    }
    const ttl = raw.values['cache.ttlSeconds']
    if (
      typeof ttl === 'number' &&
      Number.isSafeInteger(ttl) &&
      ttl >= 30 &&
      ttl <= 3600
    ) {
      this.cache.ttlSeconds = ttl
    }
    return {
      revision,
      values: Object.fromEntries(
        [...this.definitions].map(([key, def]) => [
          key,
          validateConfiguration(def, raw.values[key] ?? def.defaultValue),
        ]),
      ),
    }
  }

  async view(): Promise<ConfigurationView> {
    const snapshot = await this.snapshot()
    return {
      revision: snapshot.revision,
      items: [...this.definitions.values()].map((def) => ({
        ...def,
        value: snapshot.values[def.key]!,
      })),
    }
  }

  async history(key: string): Promise<ConfigurationHistory[]> {
    this.definition(key)
    const rows = await this.source
      .createQueryBuilder()
      .select(
        'revision,CAST(value_json AS CHAR) AS value_json,administrator_id,note,created_at',
      )
      .from('platform_configuration_history', 'platform_configuration_history')
      .where('config_key=:p0')
      .orderBy('revision', 'DESC')
      .limit(50)
      .setParameters({ p0: key })
      .getRawMany()
    return rows.map(
      (r: {
        revision: number
        value_json: unknown
        administrator_id: string | null
        note: string
        created_at: Date
      }) => ({
        revision: Number(r.revision),
        value: decode(r.value_json),
        administratorId: r.administrator_id,
        note: r.note,
        createdAt: isoTime(r.created_at),
      }),
    )
  }

  private definition(key: string) {
    const def = this.definitions.get(key)
    if (!def) {
      throw ErrorCode.CONFIGURATION_NOT_FOUND()
    }
    return def
  }

  async save(key: string, input: unknown, administratorId: string) {
    const def = this.definition(key)
    const body = input as {
      revision?: unknown
      value?: unknown
      note?: unknown
      restoreRevision?: unknown
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) => !['revision', 'value', 'note', 'restoreRevision'].includes(k),
      ) ||
      !Number.isSafeInteger(body.revision) ||
      (body.note !== undefined &&
        (typeof body.note !== 'string' || body.note.length > 500))
    ) {
      throw ErrorCode.INVALID_CONFIGURATION()
    }
    let value = body.value
    if (body.restoreRevision !== undefined) {
      if (
        !Number.isSafeInteger(body.restoreRevision) ||
        Number(body.restoreRevision) < 0 ||
        body.value !== undefined
      ) {
        throw ErrorCode.INVALID_CONFIGURATION('恢复版本无效')
      }
      const [old] = await this.source
        .createQueryBuilder()
        .select('CAST(value_json AS CHAR) AS value_json')
        .from(
          'platform_configuration_history',
          'platform_configuration_history',
        )
        .where('config_key=:p0 AND revision=:p1')
        .setParameters({ p0: key, p1: body.restoreRevision })
        .getRawMany()
      if (!old) {
        throw ErrorCode.CONFIGURATION_VERSION_NOT_FOUND()
      }
      value = decode(old.value_json)
    }
    value = validateConfiguration(def, value)
    await this.source.transaction(async (db) => {
      const state = await db
        .getRepository(PlatformConfigurationStateEntity)
        .findOne({
          select: { revision: true },
          where: { id: 1 },
          lock: { mode: 'pessimistic_write' },
        })
      if (!state || Number(state.revision) !== body.revision) {
        throw ErrorCode.CONFIGURATION_CHANGED()
      }
      await db.getRepository(PlatformConfigurationEntity).update(
        { config_key: key },
        {
          value_json: jsonDocument(value),
          updated_at: () => 'UTC_TIMESTAMP(3)',
        },
      )
      await db.getRepository(PlatformConfigurationHistoryEntity).insert({
        config_key: key,
        revision: Number(state.revision) + 1,
        value_json: jsonDocument(value),
        administrator_id: administratorId,
        note:
          body.restoreRevision !== undefined
            ? `恢复版本 ${body.restoreRevision}：${body.note ?? ''}`.slice(
                0,
                500,
              )
            : String(body.note ?? ''),
      })
      await db
        .getRepository(PlatformConfigurationStateEntity)
        .update({ id: 1 }, { revision: () => 'revision+1' })
    })
    return this.view()
  }
}
