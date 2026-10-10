import type {
  BillingUser,
  ModelPrices,
  UsageRecord,
  Wallet,
  WalletEntry,
} from '@t-box/shared'
import type { DataSource, EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { isoTime } from '@t-box/ledger-server/ledgers/time'
import { ApiError } from '@t-box/server-foundation/errors'
import { count, decimal, money, tokenFee } from './money.js'

interface WalletRow {
  balance_micro: string
  reserved_micro: string
  mode: Wallet['mode']
}
interface UsageRow {
  id: string
  user_id: string
  task_id: string | null
  model_config_id: string
  prices_json: ModelPrices | string
  kind: UsageRecord['kind']
  mode: Wallet['mode']
  status: UsageRecord['status']
  reserved_micro: string
  fee_micro: string
  charged_micro: string
  message_id: string | null
  agent_id: string | null
  purpose: import('@t-box/shared').ModelCallPurpose
  cached_tokens: string | null
  cache_write_tokens: string | null
  reasoning_tokens: string | null
  duration_ms: number | null
  input_tokens: string | null
  output_tokens: string | null
  images: number | null
  response_id: string | null
  created_at: Date
}
const viewWallet = (w: WalletRow): Wallet => ({
  currency: 'CNY',
  mode: w.mode,
  balance: decimal(BigInt(w.balance_micro)),
  reserved: decimal(BigInt(w.reserved_micro)),
  available: decimal(BigInt(w.balance_micro) - BigInt(w.reserved_micro)),
})
export class BillingService {
  constructor(readonly source: DataSource) {}
  async lock(db: EntityManager, userId: string): Promise<WalletRow> {
    await db.query(
      'INSERT INTO billing_wallets(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)',
      [userId],
    )
    const [row] = await db.query(
      'SELECT balance_micro,reserved_micro,mode FROM billing_wallets WHERE user_id=? FOR UPDATE',
      [userId],
    )
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
  }) {
    return this.source.transaction(async (db) => {
      const wallet = await this.lock(db, input.userId)
      const [old] = await db.query('SELECT id FROM billing_usage WHERE id=?', [
        input.id,
      ])
      if (old) {
        throw new ApiError(
          409,
          'USAGE_REPLAY',
          '本次调用已记录，请先核对执行结果',
        )
      }
      const reserve = wallet.mode === 'record_only' ? 0n : input.reserve
      if (
        reserve < 0n ||
        BigInt(wallet.balance_micro) - BigInt(wallet.reserved_micro) < reserve
      ) {
        throw new ApiError(
          402,
          'BALANCE_INSUFFICIENT',
          '可用余额不足，请充值后继续；已完成的操作仍保留',
        )
      }
      await db.query(
        'UPDATE billing_wallets SET reserved_micro=reserved_micro+? WHERE user_id=?',
        [reserve.toString(), input.userId],
      )
      await db.query(
        'INSERT INTO billing_usage(id,user_id,task_id,model_config_id,prices_json,kind,mode,reserved_micro,message_id,agent_id,purpose) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [
          input.id,
          input.userId,
          input.taskId ?? null,
          input.modelId,
          JSON.stringify(input.prices),
          input.kind,
          wallet.mode,
          reserve.toString(),
          input.messageId ?? null,
          input.agentId ?? null,
          input.purpose ?? 'response',
        ],
      )
      return wallet.mode
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
      const [row]: UsageRow[] = await db.query(
        'SELECT * FROM billing_usage WHERE id=? AND user_id=? FOR UPDATE',
        [id, userId],
      )
      if (!row) {
        throw new ApiError(404, 'USAGE_NOT_FOUND', '费用记录不存在')
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
          throw new ApiError(
            409,
            'USAGE_CONFLICT',
            '重复用量与已结算记录不一致',
          )
        }
        return true
      }
      if (row.status === 'released') {
        throw new ApiError(
          409,
          'USAGE_RELEASED',
          '该记录已人工解除，需人工核对费用',
        )
      }
      const price =
        typeof row.prices_json === 'string'
          ? (JSON.parse(row.prices_json) as ModelPrices)
          : row.prices_json
      if (
        usage.cachedInputTokens != null &&
        count(usage.cachedInputTokens) > count(usage.inputTokens)
      ) {
        throw new ApiError(502, 'USAGE_INVALID', '缓存用量超过输入用量')
      }
      if (
        usage.reasoningTokens != null &&
        count(usage.reasoningTokens) > count(usage.outputTokens)
      ) {
        throw new ApiError(502, 'USAGE_INVALID', '推理用量超过输出用量')
      }
      if (
        usage.cacheWriteTokens != null &&
        count(usage.cacheWriteTokens) + (usage.cachedInputTokens ?? 0) >
        count(usage.inputTokens)
      ) {
        throw new ApiError(502, 'USAGE_INVALID', '缓存读写用量超过输入用量')
      }
      const fee =
        row.kind === 'image'
          ? money(price.imagePrice) * BigInt(count(usage.images))
          : tokenFee(
              price,
              count(usage.inputTokens),
              count(usage.outputTokens),
            )
      const debit = row.mode === 'record_only' ? 0n : fee
      const otherReserved =
        BigInt(wallet.reserved_micro) - BigInt(row.reserved_micro)
      // A compatible provider may exceed the provisional budget. Preserve the actual
      // usage for review; never create negative balances or partially debit silently.
      const canPay = BigInt(wallet.balance_micro) - otherReserved >= debit
      await db.query(
        'UPDATE billing_usage SET fee_micro=?,input_tokens=?,output_tokens=?,images=?,response_id=?,cached_tokens=?,cache_write_tokens=?,reasoning_tokens=?,duration_ms=?,status=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
        [
          fee.toString(),
          usage.inputTokens ?? null,
          usage.outputTokens ?? null,
          usage.images ?? null,
          usage.responseId?.slice(0, 200) ?? null,
          usage.cachedInputTokens ?? null,
          usage.cacheWriteTokens ?? null,
          usage.reasoningTokens ?? null,
          usage.durationMs == null ? null : count(usage.durationMs),
          canPay ? 'settled' : 'review',
          id,
        ],
      )
      if (!canPay) {
        return false
      }
      const balance = BigInt(wallet.balance_micro) - debit
      await db.query(
        'UPDATE billing_wallets SET balance_micro=?,reserved_micro=? WHERE user_id=?',
        [balance.toString(), otherReserved.toString(), userId],
      )
      await db.query('UPDATE billing_usage SET charged_micro=? WHERE id=?', [
        debit.toString(),
        id,
      ])
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
      throw new ApiError(
        402,
        'USAGE_REVIEW',
        '本次用量超出可用余额，费用已保留待核对；不会重复调用',
      )
    }
  }

  async resolve(
    userId: string,
    id: string,
    administrator: string,
    reason: string,
  ) {
    const [row]: UsageRow[] = await this.source.query(
      'SELECT * FROM billing_usage WHERE id=? AND user_id=?',
      [id, userId],
    )
    if (
      !row ||
      !['review', 'settled'].includes(row.status) ||
      (row.kind === 'conversation' &&
        (row.input_tokens === null || row.output_tokens === null)) ||
        (row.kind === 'image' && row.images === null)
    ) {
      throw new ApiError(
        409,
        'USAGE_UNKNOWN',
        '尚未取得实际用量，请先核对服务商记录，或解除预留并放弃本次扣费',
      )
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
    await this.source.query(
      'UPDATE billing_usage SET status=\'review\',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=? AND status=\'reserved\'',
      [id, userId],
    )
  }

  async recover() {
    await this.source.query(
      'UPDATE billing_usage SET status=\'review\',updated_at=UTC_TIMESTAMP(3) WHERE status=\'reserved\' AND updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE)',
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
      const [row]: UsageRow[] = await db.query(
        'SELECT * FROM billing_usage WHERE id=? AND user_id=? FOR UPDATE',
        [id, userId],
      )
      if (!row || row.status !== 'review') {
        throw new ApiError(409, 'REVIEW_REQUIRED', '仅可解除待核对记录的预留')
      }
      await db.query(
        'UPDATE billing_wallets SET reserved_micro=? WHERE user_id=?',
        [
          (
            BigInt(wallet.reserved_micro) - BigInt(row.reserved_micro)
          ).toString(),
          userId,
        ],
      )
      await db.query(
        'UPDATE billing_usage SET status=\'released\',updated_at=UTC_TIMESTAMP(3) WHERE id=?',
        [id],
      )
      await this.audit(
        db,
        userId,
        administrator,
        'release',
        `${id}: ${reason}`,
      )
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
      await db.query('UPDATE billing_wallets SET mode=? WHERE user_id=?', [
        mode,
        userId,
      ])
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
    await db.query(
      'INSERT INTO billing_audit(id,user_id,administrator_id,action,detail) VALUES(?,?,?,?,?)',
      [randomUUID(), userId, administrator, action, detail],
    )
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
    await db.query(
      'INSERT INTO billing_entries(id,user_id,kind,reference_key,amount_micro,balance_micro,reason,administrator_id) VALUES(?,?,?,?,?,?,?,?)',
      [
        randomUUID(),
        userId,
        kind,
        reference,
        amount.toString(),
        balance.toString(),
        reason,
        administrator ?? null,
      ],
    )
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
    const [existing] = await db.query(
      'SELECT user_id,amount_micro,reason,administrator_id FROM billing_entries WHERE reference_key=?',
      [reference],
    )
    if (existing) {
      if (
        existing.user_id !== userId ||
        BigInt(existing.amount_micro) !== amount ||
        existing.reason !== reason ||
        existing.administrator_id !== (administrator ?? null)
      ) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '重复请求参数不一致')
      }
      return
    }
    if (
      amount <= 0n ||
      BigInt(wallet.balance_micro) + amount > 9_223_372_036_854_775_807n
    ) {
      throw new ApiError(
        400,
        'BALANCE_LIMIT',
        '入账金额须为正数，且账户余额不能超出系统处理上限',
      )
    }
    const balance = BigInt(wallet.balance_micro) + amount
    await db.query(
      'UPDATE billing_wallets SET balance_micro=? WHERE user_id=?',
      [balance.toString(), userId],
    )
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
    const rows = await this.source.query(
      'SELECT u.id,u.username,u.nickname,COALESCE(w.balance_micro,0) balance_micro,COALESCE(w.reserved_micro,0) reserved_micro,COALESCE(w.mode,\'charge\') mode FROM app_users u LEFT JOIN billing_wallets w ON w.user_id=u.id WHERE u.username LIKE ? ESCAPE \'=\' OR u.nickname LIKE ? ESCAPE \'=\' ORDER BY u.created_at DESC LIMIT 200',
      [pattern, pattern],
    )
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
    const rows: UsageRow[] = await this.source.query(
      'SELECT * FROM billing_usage WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
      [userId],
    )
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
    const rows = await this.source.query(
      'SELECT id,kind,amount_micro,balance_micro,created_at FROM billing_entries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
      [userId],
    )
    return rows.map(
      (r: {
        id: string
        kind: WalletEntry['kind']
        amount_micro: string
        balance_micro: string
        created_at: Date
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
