import type {
  BillingUser,
  ModelPrices,
  UsageRecord,
  Wallet,
  WalletEntry,
} from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import type { StoredBillingUsage } from '../db/records/billing-entities.js'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/server-foundation/time'
import { Raw } from 'typeorm'
import {
  BillingAuditEntity,
  BillingEntryEntity,
  BillingUsageEntity,
  BillingWalletEntity,
} from '../db/records/billing-entities.js'
import { ErrorCode } from '../error-codes.js'
import { admitCost } from './budget.js'
import { count, decimal, money, tokenFee } from './money.js'

interface WalletRow {
  balance_micro: string
  reserved_micro: string
  mode: Wallet['mode']
}
type UsageRow = StoredBillingUsage

const viewWallet = (w: WalletRow): Wallet => ({
  currency: 'CNY',
  mode: w.mode,
  balance: decimal(BigInt(w.balance_micro)),
  reserved: decimal(BigInt(w.reserved_micro)),
  available: decimal(BigInt(w.balance_micro) - BigInt(w.reserved_micro)),
})
export class BillingService {
  constructor(
    readonly source: DataSource,
    private readonly configuration?: {
      snapshot(): Promise<import('@t-box/shared').ConfigurationSnapshot>
    },
  ) {}

  async lock(db: EntityManager, userId: string): Promise<WalletRow> {
    await db
      .createQueryBuilder()
      .insert()
      .into('billing_wallets')
      .values({ user_id: () => ':p0' })
      .updateEntity(false)
      .setParameters({ p0: userId })
      .orUpdate(['user_id'])
      .execute()
    const row = await db.getRepository(BillingWalletEntity).findOne({
      select: { balance_micro: true, reserved_micro: true, mode: true },
      where: { user_id: userId },
      lock: { mode: 'pessimistic_write' },
    })
    if (!row) {
      throw ErrorCode.SCHEMA_REQUIRED('余额账户初始化失败')
    }
    return row
  }

  async wallet(userId: string): Promise<Wallet> {
    return this.source.transaction(async (db) =>
      viewWallet(await this.lock(db, userId)),
    )
  }

  async begin(input: {
    id: string
    userId: string
    taskId?: string
    messageId?: string
    agentId?: string
    purpose?: import('@t-box/shared').ModelCallPurpose
    modelId: string
    prices: ModelPrices
    kind: UsageRecord['kind']
    reserve: bigint
    /** Internal metadata request; records provider cost without any wallet debit. */
    free?: boolean
  }) {
    const configuration = await this.configuration?.snapshot()
    return this.source.transaction(async (db) => {
      await admitCost(db, input, configuration)
      const wallet = await this.lock(db, input.userId)
      const old = await db
        .getRepository(BillingUsageEntity)
        .findOne({ select: { id: true }, where: { id: input.id } })
      if (old) {
        throw ErrorCode.USAGE_REPLAY()
      }
      const mode = input.free ? 'record_only' : wallet.mode
      const reserve = mode === 'record_only' ? 0n : input.reserve
      if (
        reserve < 0n ||
        BigInt(wallet.balance_micro) - BigInt(wallet.reserved_micro) < reserve
      ) {
        throw ErrorCode.BALANCE_INSUFFICIENT()
      }
      await db
        .createQueryBuilder()
        .update('billing_wallets')
        .set({ reserved_micro: () => 'reserved_micro+:p0' })
        .updateEntity(false)
        .where('user_id=:p1')
        .setParameters({ p0: reserve.toString(), p1: input.userId })
        .execute()
      await db.getRepository(BillingUsageEntity).insert({
        id: input.id,
        user_id: input.userId,
        task_id: input.taskId ?? null,
        model_config_id: input.modelId,
        prices_json: input.prices,
        kind: input.kind,
        mode,
        reserved_micro: reserve.toString(),
        message_id: input.messageId ?? null,
        agent_id: input.agentId ?? null,
        purpose: input.purpose ?? 'response',
        cost_reserved_micro: input.reserve.toString(),
      })
      return mode
    })
  }

  async settle(
    userId: string,
    id: string,
    usage: {
      inputTokens?: number
      outputTokens?: number
      images?: number
      responseId?: string
      cachedInputTokens?: number | null
      cacheWriteTokens?: number | null
      reasoningTokens?: number | null
      durationMs?: number
    },
    audit?: { administrator: string, reason: string },
  ) {
    const result = await this.source.transaction(async (db) => {
      const wallet = await this.lock(db, userId)
      const row = await db.getRepository(BillingUsageEntity).findOne({
        select: {
          id: true,
          user_id: true,
          task_id: true,
          model_config_id: true,
          prices_json: true,
          kind: true,
          mode: true,
          status: true,
          reserved_micro: true,
          fee_micro: true,
          charged_micro: true,
          input_tokens: true,
          output_tokens: true,
          images: true,
          response_id: true,
          created_at: true,
          updated_at: true,
          message_id: true,
          agent_id: true,
          purpose: true,
          cached_tokens: true,
          reasoning_tokens: true,
          duration_ms: true,
          cache_write_tokens: true,
          cost_reserved_micro: true,
        },
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row) {
        throw ErrorCode.USAGE_NOT_FOUND()
      }
      if (row.status === 'settled') {
        if (
          (usage.inputTokens ?? null) !==
          (row.input_tokens === null ? null : Number(row.input_tokens)) ||
          (usage.outputTokens ?? null) !==
          (row.output_tokens === null ? null : Number(row.output_tokens)) ||
          (usage.cachedInputTokens ?? null) !==
          (row.cached_tokens === null ? null : Number(row.cached_tokens)) ||
          (usage.cacheWriteTokens ?? null) !==
          (row.cache_write_tokens === null
            ? null
            : Number(row.cache_write_tokens)) ||
            (usage.reasoningTokens ?? null) !==
            (row.reasoning_tokens === null
              ? null
              : Number(row.reasoning_tokens)) ||
              (usage.images ?? null) !== row.images ||
              (usage.responseId?.slice(0, 200) ?? null) !== row.response_id
        ) {
          throw ErrorCode.USAGE_CONFLICT()
        }
        return true
      }
      if (row.status === 'released') {
        throw ErrorCode.USAGE_RELEASED()
      }
      const price =
        typeof row.prices_json === 'string'
          ? (JSON.parse(row.prices_json) as ModelPrices)
          : row.prices_json
      if (
        usage.cachedInputTokens != null &&
        count(usage.cachedInputTokens) > count(usage.inputTokens)
      ) {
        throw ErrorCode.USAGE_INVALID('缓存用量超过输入用量')
      }
      if (
        usage.reasoningTokens != null &&
        count(usage.reasoningTokens) > count(usage.outputTokens)
      ) {
        throw ErrorCode.USAGE_INVALID('推理用量超过输出用量')
      }
      if (
        usage.cacheWriteTokens != null &&
        count(usage.cacheWriteTokens) + (usage.cachedInputTokens ?? 0) >
        count(usage.inputTokens)
      ) {
        throw ErrorCode.USAGE_INVALID('缓存读写用量超过输入用量')
      }
      const fee =
        row.kind === 'image'
          ? money(price.imagePrice) * BigInt(count(usage.images))
          : tokenFee(price, count(usage.inputTokens), count(usage.outputTokens))
      const debit = row.mode === 'record_only' ? 0n : fee
      const otherReserved =
        BigInt(wallet.reserved_micro) - BigInt(row.reserved_micro)
      // A compatible provider may exceed the provisional budget. Preserve the actual
      // usage for review; never create negative balances or partially debit silently.
      const canPay = BigInt(wallet.balance_micro) - otherReserved >= debit
      await db.getRepository(BillingUsageEntity).update(
        { id },
        {
          fee_micro: fee.toString(),
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          images: usage.images ?? null,
          response_id: usage.responseId?.slice(0, 200) ?? null,
          cached_tokens: usage.cachedInputTokens ?? null,
          cache_write_tokens: usage.cacheWriteTokens ?? null,
          reasoning_tokens: usage.reasoningTokens ?? null,
          duration_ms:
            usage.durationMs == null ? null : count(usage.durationMs),
          status: canPay ? 'settled' : 'review',
          updated_at: () => 'UTC_TIMESTAMP(3)',
        },
      )
      if (!canPay) {
        return false
      }
      const balance = BigInt(wallet.balance_micro) - debit
      await db.getRepository(BillingWalletEntity).update(
        { user_id: userId },
        {
          balance_micro: balance.toString(),
          reserved_micro: otherReserved.toString(),
        },
      )
      await db
        .getRepository(BillingUsageEntity)
        .update({ id }, { charged_micro: debit.toString() })
      if (debit) {
        await this.entry(db, userId, 'usage', `usage:${id}`, -debit, balance)
      }
      if (audit) {
        await this.audit(
          db,
          userId,
          audit.administrator,
          'settle',
          `${id}: ${audit.reason}`,
        )
      }
      return true
    })
    if (!result) {
      throw ErrorCode.USAGE_REVIEW()
    }
  }

  async resolve(
    userId: string,
    id: string,
    administrator: string,
    reason: string,
  ) {
    const row = await this.source.getRepository(BillingUsageEntity).findOne({
      select: {
        id: true,
        user_id: true,
        task_id: true,
        model_config_id: true,
        prices_json: true,
        kind: true,
        mode: true,
        status: true,
        reserved_micro: true,
        fee_micro: true,
        charged_micro: true,
        input_tokens: true,
        output_tokens: true,
        images: true,
        response_id: true,
        created_at: true,
        updated_at: true,
        message_id: true,
        agent_id: true,
        purpose: true,
        cached_tokens: true,
        reasoning_tokens: true,
        duration_ms: true,
        cache_write_tokens: true,
        cost_reserved_micro: true,
      },
      where: { id, user_id: userId },
    })
    if (
      !row ||
      !['review', 'settled'].includes(row.status) ||
      (row.kind === 'conversation' &&
        (row.input_tokens === null || row.output_tokens === null)) ||
        (row.kind === 'image' && row.images === null)
    ) {
      throw ErrorCode.USAGE_UNKNOWN()
    }
    await this.settle(
      userId,
      id,
      {
        inputTokens:
          row.input_tokens === null ? undefined : Number(row.input_tokens),
        outputTokens:
          row.output_tokens === null ? undefined : Number(row.output_tokens),
        cacheWriteTokens:
          row.cache_write_tokens === null
            ? null
            : Number(row.cache_write_tokens),
        cachedInputTokens:
          row.cached_tokens === null ? null : Number(row.cached_tokens),
        reasoningTokens:
          row.reasoning_tokens === null ? null : Number(row.reasoning_tokens),
        durationMs: row.duration_ms ?? undefined,
        images: row.images ?? undefined,
        responseId: row.response_id ?? undefined,
      },
      { administrator, reason },
    )
  }

  async uncertain(userId: string, id: string) {
    await this.source
      .getRepository(BillingUsageEntity)
      .update(
        { id, user_id: userId, status: 'reserved' },
        { status: 'review', updated_at: () => 'UTC_TIMESTAMP(3)' },
      )
  }

  async recover() {
    await this.source.getRepository(BillingUsageEntity).update(
      {
        status: 'reserved',
        updated_at: Raw(
          (column) =>
            `${column} < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)`,
        ),
      },
      { status: () => '\'review\'', updated_at: () => 'UTC_TIMESTAMP(3)' },
    )
  }

  async release(
    userId: string,
    id: string,
    administrator: string,
    reason: string,
  ) {
    await this.source.transaction(async (db) => {
      const wallet = await this.lock(db, userId)
      const row = await db.getRepository(BillingUsageEntity).findOne({
        select: {
          id: true,
          user_id: true,
          task_id: true,
          model_config_id: true,
          prices_json: true,
          kind: true,
          mode: true,
          status: true,
          reserved_micro: true,
          fee_micro: true,
          charged_micro: true,
          input_tokens: true,
          output_tokens: true,
          images: true,
          response_id: true,
          created_at: true,
          updated_at: true,
          message_id: true,
          agent_id: true,
          purpose: true,
          cached_tokens: true,
          reasoning_tokens: true,
          duration_ms: true,
          cache_write_tokens: true,
          cost_reserved_micro: true,
        },
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row || row.status !== 'review') {
        throw ErrorCode.REVIEW_REQUIRED()
      }
      await db.getRepository(BillingWalletEntity).update(
        { user_id: userId },
        {
          reserved_micro: (
            BigInt(wallet.reserved_micro) - BigInt(row.reserved_micro)
          ).toString(),
        },
      )
      await db
        .getRepository(BillingUsageEntity)
        .update(
          { id },
          { status: 'released', updated_at: () => 'UTC_TIMESTAMP(3)' },
        )
      await this.audit(db, userId, administrator, 'release', `${id}: ${reason}`)
    })
  }

  async setMode(
    userId: string,
    mode: Wallet['mode'],
    administrator: string,
    reason: string,
  ) {
    await this.source.transaction(async (db) => {
      const previous = await this.lock(db, userId)
      await db
        .getRepository(BillingWalletEntity)
        .update({ user_id: userId }, { mode })
      await this.audit(
        db,
        userId,
        administrator,
        'mode',
        `${previous.mode} -> ${mode}: ${reason}`,
      )
    })
  }

  private async audit(
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
      detail,
    })
  }

  async entry(
    db: EntityManager,
    userId: string,
    kind: WalletEntry['kind'],
    reference: string,
    amount: bigint,
    balance: bigint,
    reason = '',
    administrator?: string,
  ) {
    await db.getRepository(BillingEntryEntity).insert({
      id: randomUUID(),
      user_id: userId,
      kind,
      reference_key: reference,
      amount_micro: amount.toString(),
      balance_micro: balance.toString(),
      reason,
      administrator_id: administrator ?? null,
    })
  }

  async credit(
    db: EntityManager,
    userId: string,
    amount: bigint,
    reference: string,
    kind: 'recharge' | 'grant',
    reason = '',
    administrator?: string,
  ) {
    const wallet = await this.lock(db, userId)
    const existing = await db.getRepository(BillingEntryEntity).findOne({
      select: {
        user_id: true,
        amount_micro: true,
        reason: true,
        administrator_id: true,
      },
      where: { reference_key: reference },
    })
    if (existing) {
      if (
        existing.user_id !== userId ||
        BigInt(existing.amount_micro) !== amount ||
        existing.reason !== reason ||
        existing.administrator_id !== (administrator ?? null)
      ) {
        throw ErrorCode.IDEMPOTENCY_CONFLICT()
      }
      return
    }
    if (
      amount <= 0n ||
      BigInt(wallet.balance_micro) + amount > 9_223_372_036_854_775_807n
    ) {
      throw ErrorCode.BALANCE_LIMIT()
    }
    const balance = BigInt(wallet.balance_micro) + amount
    await db
      .getRepository(BillingWalletEntity)
      .update({ user_id: userId }, { balance_micro: balance.toString() })
    await this.entry(
      db,
      userId,
      kind,
      reference,
      amount,
      balance,
      reason,
      administrator,
    )
  }

  async grant(
    userId: string,
    amount: string,
    key: string,
    reason: string,
    administrator: string,
  ) {
    await this.source.transaction((db) =>
      this.credit(
        db,
        userId,
        money(amount),
        `grant:${userId}:${key}`,
        'grant',
        reason,
        administrator,
      ),
    )
  }

  async users(search = ''): Promise<BillingUser[]> {
    const pattern = `%${search.replace(/[=%_]/g, '=$&')}%`
    const rows = await this.source
      .createQueryBuilder()
      .select(
        'u.id,u.username,u.nickname,COALESCE(w.balance_micro,0) balance_micro,COALESCE(w.reserved_micro,0) reserved_micro,COALESCE(w.mode,\'charge\') mode',
      )
      .from('app_users', 'u')
      .leftJoin('billing_wallets', 'w', 'w.user_id=u.id')
      .where('u.username LIKE :p0 ESCAPE \'=\' OR u.nickname LIKE :p1 ESCAPE \'=\'')
      .orderBy('u.created_at', 'DESC')
      .limit(200)
      .setParameters({ p0: pattern, p1: pattern })
      .getRawMany()
    return rows.map(
      (r: WalletRow & { id: string, username: string, nickname: string }) => ({
        id: r.id,
        username: r.username,
        nickname: r.nickname,
        ...viewWallet(r),
      }),
    )
  }

  async records(userId: string): Promise<UsageRecord[]> {
    const rows: UsageRow[] = await this.source
      .getRepository(BillingUsageEntity)
      .find({
        select: {
          id: true,
          user_id: true,
          task_id: true,
          model_config_id: true,
          prices_json: true,
          kind: true,
          mode: true,
          status: true,
          reserved_micro: true,
          fee_micro: true,
          charged_micro: true,
          input_tokens: true,
          output_tokens: true,
          images: true,
          response_id: true,
          created_at: true,
          updated_at: true,
          message_id: true,
          agent_id: true,
          purpose: true,
          cached_tokens: true,
          reasoning_tokens: true,
          duration_ms: true,
          cache_write_tokens: true,
          cost_reserved_micro: true,
        },
        where: { user_id: userId },
        order: { created_at: 'DESC', id: 'DESC' },
        take: 100,
      })
    // An explicit allowlist keeps server model IDs, prices and upstream response IDs private.
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      mode: r.mode,
      fee: decimal(BigInt(r.fee_micro)),
      charged: decimal(BigInt(r.charged_micro)),
      inputTokens: r.input_tokens === null ? null : Number(r.input_tokens),
      outputTokens: r.output_tokens === null ? null : Number(r.output_tokens),
      cacheWriteTokens:
        r.cache_write_tokens == null ? null : Number(r.cache_write_tokens),
      cachedInputTokens:
        r.cached_tokens == null ? null : Number(r.cached_tokens),
      reasoningTokens:
        r.reasoning_tokens == null ? null : Number(r.reasoning_tokens),
      messageId: r.message_id,
      agentId: r.agent_id,
      purpose: r.purpose,
      images: r.images,
      taskId: r.task_id,
      createdAt: isoTime(r.created_at),
    }))
  }

  async entries(userId: string): Promise<WalletEntry[]> {
    const rows = await this.source.getRepository(BillingEntryEntity).find({
      select: {
        id: true,
        kind: true,
        amount_micro: true,
        balance_micro: true,
        created_at: true,
      },
      where: { user_id: userId },
      order: { created_at: 'DESC', id: 'DESC' },
      take: 100,
    })
    return rows.map(
      (r: {
        id: string
        kind: WalletEntry['kind']
        amount_micro: string
        balance_micro: string
        created_at: Date | string
      }) => ({
        id: r.id,
        kind: r.kind,
        amount: decimal(BigInt(r.amount_micro)),
        balance: decimal(BigInt(r.balance_micro)),
        createdAt: isoTime(r.created_at),
      }),
    )
  }
}
