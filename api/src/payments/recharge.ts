import type { AdminRechargeConfiguration, RechargeConfiguration } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { ConfigurationCache } from '../configuration/cache.js'
import { object } from '@t-box/ledger-server/ledgers/validation'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  rechargeBonusCents,
  rechargeCents,
  rechargeOfferBonusCents,
} from '@t-box/shared'
import { EntitySchema } from 'typeorm'
import { money } from '../billing/money.js'

const defaults: RechargeConfiguration = {
  presets: [],
  customEnabled: false,
  bonusRules: [],
  minAmount: '1',
  maxAmount: '10000',
}
interface RechargeRow {
  id: number
  configuration: RechargeConfiguration
  revision: number
  updatedAt: Date | null
  updatedBy: string | null
}
export const RechargeSettingsEntity = new EntitySchema<RechargeRow>({
  name: 'RechargeSettings',
  tableName: 'recharge_settings',
  columns: {
    id: { type: 'tinyint', primary: true },
    configuration: { type: 'json' },
    revision: { type: 'int', default: 1 },
    updatedAt: {
      type: 'datetime',
      precision: 3,
      name: 'updated_at',
      nullable: true,
    },
    updatedBy: { type: 'char', length: 36, name: 'updated_by', nullable: true },
  },
})
const invalid = (message: string): never => {
  throw new ApiError(400, 'INVALID_RECHARGE_CONFIG', message)
}
const yuan = (cents: number) => (cents / 100).toFixed(2)
export function parseRechargeConfiguration(
  value: unknown,
): RechargeConfiguration {
  const input = object(value, [
    'presets',
    'bonusRules',
    'customEnabled',
    'revision',
  ])
  if (typeof input.customEnabled !== 'boolean') {
    invalid('请选择是否开启自定义充值')
  }
  if (!Array.isArray(input.presets) || input.presets.length > 12) {
    invalid('充值套餐最多 12 项')
  }
  const amounts = new Set<number>()
  const presets = (input.presets as unknown[])
    .map((v) => {
      const row = object(v, ['amount', 'bonusAmount', 'enabled'])
      const cents = rechargeCents(row.amount)
      if (cents === null) {
        invalid('套餐金额须为 1–10000 元，最多 2 位小数')
      }
      if (amounts.has(cents!)) {
        invalid('套餐金额不能重复')
      }
      amounts.add(cents!)
      if (typeof row.enabled !== 'boolean') {
        invalid('请选择套餐是否上架')
      }
      const bonus = money(row.bonusAmount)
      if (bonus > 10_000_000_000n || bonus % 10_000n) {
        invalid('套餐赠送金额须为 0–10000 元，最多 2 位小数')
      }
      return {
        amount: yuan(cents!),
        bonusAmount: yuan(Number(bonus / 10_000n)),
        enabled: row.enabled as boolean,
      }
    })
    .sort((a, b) => Number(a.amount) - Number(b.amount))
  if (!Array.isArray(input.bonusRules) || input.bonusRules.length > 20) {
    invalid('满赠规则最多 20 项')
  }
  const thresholds = new Set<number>()
  const bonusRules = (input.bonusRules as unknown[])
    .map((v) => {
      const row = object(v, ['threshold', 'bonus'])
      const threshold = rechargeCents(row.threshold)
      if (threshold === null || thresholds.has(threshold)) {
        invalid('满赠门槛须为 1–10000 元，且不能重复')
      }
      thresholds.add(threshold!)
      const bonus = money(row.bonus)
      if (bonus < 10_000n || bonus > 10_000_000_000n || bonus % 10_000n) {
        invalid('赠送金额须为 0.01–10000 元，最多 2 位小数')
      }
      return {
        threshold: yuan(threshold!),
        bonus: yuan(Number(bonus / 10_000n)),
      }
    })
    .sort((a, b) => Number(a.threshold) - Number(b.threshold))
  return {
    ...defaults,
    presets,
    customEnabled: input.customEnabled as boolean,
    bonusRules,
  }
}
export class RechargeSettingsService {
  constructor(
    private readonly source: Pick<DataSource, 'getRepository'>,
    private readonly cache?: ConfigurationCache,
  ) {}

  async configuration(): Promise<AdminRechargeConfiguration> {
    if (this.cache) {
      return this.cache.current(this.source as DataSource, 'recharge', () =>
        this.load())
    }
    return this.load()
  }

  private async load(): Promise<AdminRechargeConfiguration> {
    const row = await this.source
      .getRepository(RechargeSettingsEntity)
      .findOneBy({ id: 1 })
    if (!row) {
      throw new ApiError(503, 'SCHEMA_REQUIRED', '请先初始化充值配置数据库')
    }
    return {
      ...structuredClone(row.configuration),
      revision: row.revision,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  }

  async publicConfiguration(): Promise<RechargeConfiguration> {
    const {
      revision: _,
      updatedAt: __,
      ...config
    } = await this.configuration()
    return {
      ...config,
      presets: config.presets.filter((preset) => preset.enabled),
    }
  }

  async save(value: unknown, administratorId: string) {
    const config = parseRechargeConfiguration(value)
    const revision = (value as { revision?: unknown }).revision
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      invalid('请重新加载充值配置后保存')
    }
    const update = async (source: Pick<DataSource, 'getRepository'>) =>
      source.getRepository(RechargeSettingsEntity).update(
        { id: 1, revision: Number(revision) },
        {
          configuration: config,
          revision: Number(revision) + 1,
          updatedBy: administratorId,
          updatedAt: new Date(),
        },
      )
    const result = this.cache
      ? await (this.source as DataSource).transaction(async (db) => {
          const result = await update(db)
          if (result.affected) {
            await db.query(
              'UPDATE platform_configuration_state SET revision=revision+1 WHERE id=1',
            )
          }
          return result
        })
      : await update(this.source)
    if (!result.affected) {
      throw new ApiError(
        409,
        'CONFIGURATION_CHANGED',
        '配置已被更新，请刷新后重试',
      )
    }
    return this.configuration()
  }

  async bonusCents(amountCents: number) {
    const config = await this.configuration()
    const bonus = rechargeOfferBonusCents(amountCents, config)
    if (bonus === null) {
      throw new ApiError(
        403,
        'CUSTOM_RECHARGE_DISABLED',
        '自定义充值未开启，请选择已上架的充值套餐',
      )
    }
    return bonus
  }
}

/** Preserve existing preset benefits during the one-time catalog migration. */
export function upgradeRechargeConfiguration(
  value: unknown,
): RechargeConfiguration {
  const config = value as {
    presets: unknown[]
    bonusRules: RechargeConfiguration['bonusRules']
    customEnabled?: boolean
  }
  const presets = config.presets.map((preset) =>
    typeof preset === 'string'
      ? {
          amount: preset,
          bonusAmount: yuan(
            rechargeBonusCents(rechargeCents(preset)!, config.bonusRules),
          ),
          enabled: true,
        }
      : preset,
  )
  return parseRechargeConfiguration({
    presets,
    bonusRules: config.bonusRules,
    customEnabled: config.customEnabled ?? false,
  })
}
