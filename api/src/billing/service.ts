import type {
  BillingUser,
  ModelPrices,
  QuotaUsageBudget,
  UsageRecord,
  Wallet,
  WalletEntry,
} from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import type { ConfigurationCache } from '../configuration/cache.js'
import type { StoredBillingUsage } from '../db/records/billing-entities.js'
import { randomUUID } from 'node:crypto'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { isoTime } from '@t-box/server-foundation/time'
import { LessThan, Like } from 'typeorm'
import {
  BillingAuditEntity,
  BillingUsageEntity,
} from '../db/records/billing-entities.js'
import { ErrorCode } from '../error-codes.js'
import { admitCost } from './budget.js'
import { count, money, tokenFee } from './money.js'
import { QuotaCatalog } from './quota/catalog.js'
import { QuotaAccountEntity, QuotaEntryEntity } from './quota/entities.js'
import { now, QuotaInventory } from './quota/inventory.js'
import { quota, quotaFee, quotaText } from './quota/math.js'

export interface BillingBegin {
  id: string
  userId: string
  taskId?: string
  messageId?: string
  agentId?: string
  logicalRequestId?: string
  retryIndex?: number
  purpose?: import('@t-box/shared').ModelCallPurpose
  modelId: string
  prices: ModelPrices
  kind: UsageRecord['kind']
  /** Supplier cost admission reserve, in integer micro-yuan, independent of public credit prices. */
  reserve: bigint
  budget: QuotaUsageBudget
  free?: boolean
}
export interface ActualUsage {
  inputTokens?: number
  outputTokens?: number
  images?: number
  responseId?: string
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  durationMs?: number
  tier?: import('@t-box/shared').ImageTier
}
export const usageFields = {
  id: true,
  user_id: true,
  task_id: true,
  message_id: true,
  agent_id: true,
  purpose: true,
  model_config_id: true,
  prices_json: true,
  kind: true,
  mode: true,
  status: true,
  fee_micro: true,
  upstream_original_micro: true,
  cost_reserved_micro: true,
  quota_reserved: true,
  quota_budget: true,
  quota_due: true,
  quota_charged: true,
  tariff_json: true,
  budget_json: true,
  platform_free: true,
  logical_id: true,
  retry_index: true,
  input_tokens: true,
  output_tokens: true,
  images: true,
  response_id: true,
  created_at: true,
  updated_at: true,
  cached_tokens: true,
  reasoning_tokens: true,
  duration_ms: true,
  cache_write_tokens: true,
} as const
export class BillingService {
  readonly inventory = new QuotaInventory()
  readonly catalog: QuotaCatalog
  private readonly listeners = new Set<(userId: string) => void>()
  constructor(
    readonly source: DataSource,
    private readonly configuration?: {
      snapshot(): Promise<import('@t-box/shared').ConfigurationSnapshot>
    },
    cache?: ConfigurationCache,
  ) {
    this.catalog = new QuotaCatalog(source, cache)
  }

  onChange(listener: (userId: string) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  changed(userId: string) {
    for (const listener of this.listeners) {
      try {
        listener(userId)
      } catch {
        /* Notification never rolls back committed accounting. */
      }
    }
  }

  lock(db: EntityManager, userId: string) {
    return this.inventory.lock(db, userId)
  }

  wallet(userId: string): Promise<Wallet> {
    return this.source.transaction((db) => this.inventory.wallet(db, userId))
  }

  lots(userId: string) {
    return this.source.transaction((db) => this.inventory.lots(db, userId))
  }

  async begin(input: BillingBegin) {
    const configured = await this.catalog.tariff()
    const configuration = await this.configuration?.snapshot()
    const result = await this.source.transaction(async (db) => {
      await admitCost(db, input, configuration)
      const account = await this.lock(db, input.userId)
      if (
        await db.getRepository(BillingUsageEntity).existsBy({ id: input.id })
      ) {
        throw ErrorCode.USAGE_REPLAY()
      }
      const task = input.taskId
        ? await db.getRepository(BillingUsageEntity).find({
            select: {
              tariff_json: true,
              platform_free: true,
              status: true,
              quota_budget: true,
              quota_due: true,
              budget_json: true,
              images: true,
            },
            where: { user_id: input.userId, task_id: input.taskId },
            order: { created_at: 'ASC' },
          })
        : []
      const tariff =
        task.find((row) => !row.platform_free)?.tariff_json ?? configured
      const free = input.free === true
      if (!free && !tariff.enabled) {
        throw ErrorCode.QUOTA_TARIFF_REQUIRED()
      }
      const budget = input.budget
      if (
        !free &&
        input.kind === 'conversation' &&
        (budget.inputTokens === undefined || budget.outputTokens === undefined)
      ) {
        throw ErrorCode.QUOTA_INVALID('模型调用必须提供输入与输出预算')
      }
      if (input.kind === 'image' && budget.images !== 1) {
        throw ErrorCode.QUOTA_INVALID('每个图片计费单元仅生成一张图片')
      }
      const quoted = free ? 0n : quotaFee(tariff, budget)
      const running = task.filter(
        (row) =>
          !row.platform_free && ['reserved', 'settled'].includes(row.status),
      )
      const used = running.reduce(
        (sum, row) =>
          sum +
          BigInt(row.status === 'reserved' ? row.quota_budget : row.quota_due),
        0n,
      )
      const images = running.reduce(
        (sum, row) =>
          sum +
          (row.status === 'reserved'
            ? (row.budget_json.images ?? 0)
            : (row.images ?? 0)),
        0,
      )
      if (
        !free &&
        (used + quoted > quota(tariff.taskLimit) ||
          images + (budget.images ?? 0) > tariff.imageLimit)
      ) {
        throw ErrorCode.QUOTA_TASK_LIMIT()
      }
      const mode = free ? 'record_only' : account.mode
      const reserved = mode === 'charge' ? quoted : 0n
      await this.inventory.reserve(db, input.userId, input.id, reserved)
      await db.getRepository(BillingUsageEntity).insert({
        id: input.id,
        user_id: input.userId,
        task_id: input.taskId ?? null,
        message_id: input.messageId ?? null,
        agent_id: input.agentId ?? null,
        purpose: input.purpose ?? 'response',
        model_config_id: input.modelId,
        prices_json: input.prices,
        kind: input.kind,
        mode,
        platform_free: free,
        quota_reserved: reserved.toString(),
        quota_budget: quoted.toString(),
        quota_due: '0',
        quota_charged: '0',
        tariff_json: tariff,
        budget_json: budget,
        cost_reserved_micro: input.reserve.toString(),
        logical_id: input.logicalRequestId ?? input.id,
        retry_index: input.retryIndex ?? 0,
      })
      return mode
    })
    this.changed(input.userId)
    return result
  }

  async settle(
    userId: string,
    id: string,
    usage: ActualUsage,
    audit?: { administrator: string, reason: string },
  ) {
    await this.source.transaction(async (db) => {
      await this.lock(db, userId)
      const repo = db.getRepository(BillingUsageEntity)
      const row = await repo.findOne({
        select: usageFields,
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row) {
        throw ErrorCode.USAGE_NOT_FOUND()
      }
      const fingerprint = (value: ActualUsage) =>
        JSON.stringify([
          value.inputTokens ?? null,
          value.outputTokens ?? null,
          value.images ?? null,
          value.responseId?.slice(0, 200) ?? null,
          value.cachedInputTokens ?? null,
          value.cacheWriteTokens ?? null,
          value.reasoningTokens ?? null,
        ])
      const previous: ActualUsage = {
        inputTokens:
          row.input_tokens == null ? undefined : Number(row.input_tokens),
        outputTokens:
          row.output_tokens == null ? undefined : Number(row.output_tokens),
        images: row.images ?? undefined,
        responseId: row.response_id ?? undefined,
        cachedInputTokens:
          row.cached_tokens == null ? null : Number(row.cached_tokens),
        cacheWriteTokens:
          row.cache_write_tokens == null
            ? null
            : Number(row.cache_write_tokens),
        reasoningTokens:
          row.reasoning_tokens == null ? null : Number(row.reasoning_tokens),
      }
      if (row.status === 'settled') {
        if (fingerprint(previous) !== fingerprint(usage)) {
          throw ErrorCode.USAGE_CONFLICT()
        }
        return
      }
      if (['released', 'reversed'].includes(row.status)) {
        throw ErrorCode.USAGE_RELEASED()
      }
      const input = count(usage.inputTokens ?? 0)
      const output = count(usage.outputTokens ?? 0)
      if (
        (usage.cachedInputTokens != null &&
          count(usage.cachedInputTokens) > input) ||
          (usage.reasoningTokens != null &&
            count(usage.reasoningTokens) > output) ||
            (usage.cacheWriteTokens != null &&
              count(usage.cacheWriteTokens) + (usage.cachedInputTokens ?? 0) >
              input)
      ) {
        throw ErrorCode.USAGE_INVALID()
      }
      if (
        row.kind === 'conversation' &&
        (usage.inputTokens === undefined || usage.outputTokens === undefined)
      ) {
        throw ErrorCode.USAGE_MISSING()
      }
      if (row.kind === 'image' && usage.images !== 1) {
        throw ErrorCode.USAGE_INVALID()
      }
      const price = row.prices_json
      const original =
        row.kind === 'image'
          ? money(price.imagePrice) * BigInt(count(usage.images))
          : tokenFee(price, input, output)
      const cost =
        (original * money(price.costMultiplier ?? '1') + 999999n) / 1000000n
      const rawFee = row.platform_free
        ? 0n
        : quotaFee(row.tariff_json, {
            ...row.budget_json,
            inputTokens: input,
            outputTokens: output,
            cachedInputTokens: usage.cachedInputTokens,
            ...(row.kind === 'image'
              ? {
                  images: usage.images,
                  tier: usage.tier ?? row.budget_json.tier,
                }
              : {}),
          })
      // A supplier exceeding the admitted envelope cannot debit unreserved user credits.
      const due =
        rawFee > BigInt(row.quota_budget) ? BigInt(row.quota_budget) : rawFee
      if (rawFee > BigInt(row.quota_budget)) {
        console.warn('QUOTA_AUTHORIZATION_EXCEEDED', id)
      }
      const charged =
        row.mode === 'charge'
          ? await this.inventory.capture(db, userId, id, due)
          : 0n
      await repo.update(
        { id },
        {
          status: 'settled',
          fee_micro: cost.toString(),
          upstream_original_micro: original.toString(),
          quota_due: rawFee.toString(),
          quota_charged: charged.toString(),
          quota_reserved: '0',
          quota_budget: '0',
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          images: usage.images ?? null,
          response_id: usage.responseId?.slice(0, 200) ?? null,
          cached_tokens: usage.cachedInputTokens ?? null,
          cache_write_tokens: usage.cacheWriteTokens ?? null,
          reasoning_tokens: usage.reasoningTokens ?? null,
          duration_ms: usage.durationMs ?? null,
          updated_at: now(),
        },
      )
      if (audit) {
        await this.audit(
          db,
          userId,
          audit.administrator,
          'settle',
          `${id}: ${audit.reason}`,
        )
      }
    })
    this.changed(userId)
  }

  /** Known failed attempt: compensate any early usage charge, preserve upstream costs and usage. */
  async failed(userId: string, id: string) {
    await this.source.transaction(async (db) => {
      await this.lock(db, userId)
      const row = await db.getRepository(BillingUsageEntity).findOne({
        select: { status: true },
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row || ['released', 'reversed'].includes(row.status)) {
        return
      }
      if (row.status === 'settled') {
        await this.inventory.reverse(db, userId, id)
      } else {
        await this.inventory.capture(db, userId, id, 0n)
      }
      await db.getRepository(BillingUsageEntity).update(
        { id },
        {
          status: row.status === 'settled' ? 'reversed' : 'review',
          quota_reserved: '0',
          quota_budget: '0',
          quota_charged: '0',
          updated_at: now(),
        },
      )
    })
    this.changed(userId)
  }

  uncertain(userId: string, id: string) {
    return this.failed(userId, id)
  }

  async heartbeat(userId: string, id: string) {
    await this.source
      .getRepository(BillingUsageEntity)
      .update(
        { id, user_id: userId, status: 'reserved' },
        { updated_at: now() },
      )
  }

  keepAlive(userId: string, id: string) {
    let pending: Promise<unknown> | undefined
    const timer = setInterval(() => {
      pending ??= this.heartbeat(userId, id)
        .catch(() => {})
        .finally(() => {
          pending = undefined
        })
    }, 25000)
    timer.unref()
    return async () => {
      clearInterval(timer)
      await pending
    }
  }

  async recover() {
    const rows = await this.source.getRepository(BillingUsageEntity).find({
      select: { id: true, user_id: true },
      where: {
        status: 'reserved',
        updated_at: LessThan(
          new Date(Date.now() - 10 * 60000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, -1),
        ),
      },
      take: 100,
    })
    for (const row of rows) {
      await this.failed(row.user_id, row.id)
    }
  }

  async release(
    userId: string,
    id: string,
    administrator: string,
    reason: string,
  ) {
    await this.source.transaction(async (db) => {
      await this.lock(db, userId)
      const row = await db.getRepository(BillingUsageEntity).findOne({
        select: { status: true },
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row || row.status !== 'review') {
        throw ErrorCode.REVIEW_REQUIRED()
      }
      await this.inventory.capture(db, userId, id, 0n)
      await db.getRepository(BillingUsageEntity).update(
        { id },
        {
          status: 'released',
          quota_reserved: '0',
          quota_budget: '0',
          updated_at: now(),
        },
      )
      await this.audit(db, userId, administrator, 'release', `${id}: ${reason}`)
    })
    this.changed(userId)
  }

  async resolve(
    userId: string,
    id: string,
    administrator: string,
    reason: string,
  ) {
    const row = await this.source
      .getRepository(BillingUsageEntity)
      .findOne({ select: usageFields, where: { id, user_id: userId } })
    // Reconciliation records supplier cost only. Released user authorizations are never silently re-debited.
    if (!row || row.status !== 'review' || row.input_tokens === null) {
      throw ErrorCode.USAGE_UNKNOWN()
    }
    await this.release(userId, id, administrator, reason)
  }

  async setMode(
    userId: string,
    mode: Wallet['mode'],
    administrator: string,
    reason: string,
  ) {
    if (!['charge', 'record_only'].includes(mode)) {
      throw ErrorCode.QUOTA_INVALID()
    }
    await this.source.transaction(async (db) => {
      const previous = await this.lock(db, userId)
      await db
        .getRepository(QuotaAccountEntity)
        .update({ userId }, { mode, revision: previous.revision + 1 })
      await this.audit(
        db,
        userId,
        administrator,
        'mode',
        `${previous.mode} -> ${mode}: ${reason}`,
      )
    })
    this.changed(userId)
  }

  async audit(
    db: EntityManager,
    userId: string,
    administrator: string,
    action: string,
    detail: string,
  ) {
    await db.getRepository(BillingAuditEntity).insert({
      id: randomUUID(),
      user_id: userId,
      administrator_id: administrator,
      action,
      detail: detail.slice(0, 300),
    })
  }

  async grant(
    userId: string,
    amount: string,
    key: string,
    reason: string,
    administrator: string,
    validDays = 180,
  ) {
    await this.source.transaction(async (db) => {
      await this.inventory.grant(db, {
        userId,
        amount: quota(amount),
        sourceKey: `grant:${userId}:${key}`,
        name: reason.slice(0, 80),
        validDays,
        source: 'grant',
      })
      await this.audit(
        db,
        userId,
        administrator,
        'grant',
        `${amount}额度 / ${validDays}天：${reason}`,
      )
    })
    this.changed(userId)
  }

  async users(search = ''): Promise<BillingUser[]> {
    const rows = await this.source.getRepository(AppUserEntity).find({
      select: { id: true, username: true, nickname: true },
      where: [
        { username: Like(`%${search}%`) },
        { nickname: Like(`%${search}%`) },
      ],
      order: { createdAt: 'DESC' },
      take: 100,
    })
    const result: BillingUser[] = []
    for (const row of rows) {
      result.push({ ...row, ...(await this.wallet(row.id)) })
    }
    return result
  }

  async records(userId: string): Promise<UsageRecord[]> {
    const rows: StoredBillingUsage[] = await this.source
      .getRepository(BillingUsageEntity)
      .find({
        select: usageFields,
        where: { user_id: userId },
        order: { created_at: 'DESC', id: 'DESC' },
        take: 100,
      })
    const result: UsageRecord[] = []
    for (const r of rows) {
      result.push({
        id: r.id,
        kind: r.kind,
        status: r.status,
        mode: r.mode,
        fee: quotaText(BigInt(r.quota_due)),
        charged: quotaText(BigInt(r.quota_charged)),
        inputTokens: r.input_tokens === null ? null : Number(r.input_tokens),
        outputTokens: r.output_tokens === null ? null : Number(r.output_tokens),
        cacheWriteTokens:
          r.cache_write_tokens === null ? null : Number(r.cache_write_tokens),
        cachedInputTokens:
          r.cached_tokens === null ? null : Number(r.cached_tokens),
        reasoningTokens:
          r.reasoning_tokens === null ? null : Number(r.reasoning_tokens),
        messageId: r.message_id,
        agentId: r.agent_id,
        purpose: r.purpose,
        images: r.images,
        imageTier: r.budget_json.tier,
        taskId: r.task_id,
        createdAt: isoTime(r.created_at),
        allocations: await this.inventory.allocations(
          this.source.manager,
          userId,
          r.id,
        ),
      })
    }
    return result
  }

  async entries(userId: string): Promise<WalletEntry[]> {
    return (
      await this.source.getRepository(QuotaEntryEntity).find({
        select: {
          id: true,
          kind: true,
          amount: true,
          reason: true,
          lotId: true,
          createdAt: true,
        },
        where: { userId },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 100,
      })
    ).map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: quotaText(BigInt(row.amount)),
      reason: row.reason,
      lotId: row.lotId,
      createdAt: isoTime(row.createdAt),
    }))
  }
}
