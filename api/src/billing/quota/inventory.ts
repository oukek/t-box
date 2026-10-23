import type { QuotaAllocation, QuotaLot, Wallet } from '@t-box/shared'
import type { EntityManager } from 'typeorm'
import type { LotRow, QuotaEntryRow } from './entities.js'
import { randomUUID } from 'node:crypto'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { isoTime } from '@t-box/server-foundation/time'
import { LessThanOrEqual, MoreThan } from 'typeorm'
import { ErrorCode } from '../../error-codes.js'
import {
  QuotaAccountEntity,
  QuotaAllocationEntity,
  QuotaEntryEntity,
  QuotaLotEntity,
} from './entities.js'
import { quotaText } from './math.js'

export const now = () => sqlClock(new Date())
export class QuotaInventory {
  async lock(db: EntityManager, userId: string) {
    const repo = db.getRepository(QuotaAccountEntity)
    await repo.upsert(
      { userId },
      { conflictPaths: ['userId'], skipUpdateIfNoValuesChanged: true },
    )
    return repo.findOneOrFail({
      select: { userId: true, mode: true, revision: true },
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    })
  }

  async touch(db: EntityManager, userId: string) {
    await db
      .getRepository(QuotaAccountEntity)
      .increment({ userId }, 'revision', 1)
  }

  private async event(
    db: EntityManager,
    lot: LotRow,
    reference: string,
    kind: QuotaEntryRow['kind'],
    amount: bigint,
    reason = '',
  ) {
    await db.getRepository(QuotaEntryEntity).insert({
      id: randomUUID(),
      userId: lot.userId,
      lotId: lot.id,
      reference: `${kind}:${reference}:${lot.id}`,
      kind,
      amount: amount.toString(),
      reason: reason.slice(0, 200),
      createdAt: now(),
    })
  }

  async expire(db: EntityManager, userId: string) {
    const repo = db.getRepository(QuotaLotEntity)
    const lots = await repo.find({
      where: {
        userId,
        expiresAt: LessThanOrEqual(now()),
        available: MoreThan('0'),
      },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    })
    for (const lot of lots) {
      await repo.update(
        { id: lot.id },
        {
          available: '0',
          expired: (BigInt(lot.expired) + BigInt(lot.available)).toString(),
        },
      )
      await this.event(
        db,
        lot,
        `expiry:${lot.expiresAt}:${lot.expired}`,
        'expire',
        BigInt(lot.available),
      )
    }
    if (lots.length) {
      await this.touch(db, userId)
    }
  }

  async wallet(db: EntityManager, userId: string): Promise<Wallet> {
    const account = await this.lock(db, userId)
    await this.expire(db, userId)
    const totals = await db
      .getRepository(QuotaLotEntity)
      .createQueryBuilder('lot')
      .select('COALESCE(SUM(lot.available),0)', 'available')
      .addSelect('COALESCE(SUM(lot.reserved),0)', 'reserved')
      .where('lot.userId=:userId', { userId })
      .getRawOne<{ available: string, reserved: string }>()
    const available = BigInt(totals?.available ?? '0')
    const reserved = BigInt(totals?.reserved ?? '0')
    return {
      currency: 'QUOTA',
      mode: account.mode,
      balance: quotaText(available + reserved),
      available: quotaText(available),
      reserved: quotaText(reserved),
      revision: (
        await db.getRepository(QuotaAccountEntity).findOneByOrFail({ userId })
      ).revision,
    }
  }

  async grant(
    db: EntityManager,
    input: {
      userId: string
      amount: bigint
      sourceKey: string
      name: string
      validDays: number
      source: LotRow['source']
      orderId?: string
      packageVersionId?: string
      createdAt?: Date
    },
  ) {
    if (
      input.amount <= 0n ||
      input.amount > 10000000000000n ||
      !Number.isInteger(input.validDays) ||
      input.validDays < 1 ||
      input.validDays > 3650
    ) {
      throw ErrorCode.QUOTA_INVALID()
    }
    await this.lock(db, input.userId)
    const repo = db.getRepository(QuotaLotEntity)
    const old = await repo.findOne({ where: { sourceKey: input.sourceKey } })
    if (old) {
      if (
        old.userId !== input.userId ||
        BigInt(old.total) !== input.amount ||
        old.name !== input.name.slice(0, 80) ||
        old.source !== input.source ||
        old.orderId !== (input.orderId ?? null) ||
        Math.round(
          (Date.parse(isoTime(old.expiresAt)) -
            Date.parse(isoTime(old.createdAt))) /
            86400000,
        ) !== input.validDays
      ) {
        throw ErrorCode.IDEMPOTENCY_CONFLICT()
      }
      return old.id
    }
    const at = input.createdAt ?? new Date()
    const row: LotRow = {
      id: randomUUID(),
      userId: input.userId,
      sourceKey: input.sourceKey,
      name: input.name.slice(0, 80),
      source: input.source,
      total: input.amount.toString(),
      available: input.amount.toString(),
      reserved: '0',
      consumed: '0',
      expired: '0',
      revoked: '0',
      createdAt: sqlClock(at),
      expiresAt: sqlClock(new Date(at.getTime() + input.validDays * 86400000)),
      orderId: input.orderId ?? null,
      packageVersionId: input.packageVersionId ?? null,
    }
    await repo.insert(row)
    await this.event(
      db,
      row,
      input.sourceKey,
      input.source === 'purchase' ? 'purchase' : 'grant',
      input.amount,
      input.name,
    )
    await this.touch(db, input.userId)
    return row.id
  }

  async reserve(
    db: EntityManager,
    userId: string,
    reference: string,
    amount: bigint,
  ) {
    await this.expire(db, userId)
    if (amount < 0n) {
      throw ErrorCode.QUOTA_INVALID()
    }
    if (amount === 0n) {
      return
    }
    const repo = db.getRepository(QuotaLotEntity)
    const lots = await repo.find({
      where: { userId, available: MoreThan('0'), expiresAt: MoreThan(now()) },
      order: { expiresAt: 'ASC', createdAt: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    })
    if (lots.reduce((sum, lot) => sum + BigInt(lot.available), 0n) < amount) {
      throw ErrorCode.QUOTA_INSUFFICIENT()
    }
    let left = amount
    for (const lot of lots) {
      if (!left) {
        break
      }
      const n = left < BigInt(lot.available) ? left : BigInt(lot.available)
      await repo.update(
        { id: lot.id },
        {
          available: (BigInt(lot.available) - n).toString(),
          reserved: (BigInt(lot.reserved) + n).toString(),
        },
      )
      await db.getRepository(QuotaAllocationEntity).insert({
        id: randomUUID(),
        userId,
        reference,
        lotId: lot.id,
        allocated: n.toString(),
        reserved: n.toString(),
        consumed: '0',
        released: '0',
        returned: '0',
        createdAt: now(),
      })
      await this.event(db, lot, reference, 'reserve', n)
      left -= n
    }
    await this.touch(db, userId)
  }

  /** Account lock is held by the caller. Settlement never draws from unreserved lots. */
  async capture(
    db: EntityManager,
    userId: string,
    reference: string,
    requested: bigint,
    revoke = false,
  ) {
    const allocations = await db.getRepository(QuotaAllocationEntity).find({
      where: { userId, reference },
      order: { createdAt: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    })
    const lots = new Map<string, LotRow>()
    for (const allocation of allocations) {
      lots.set(
        allocation.lotId,
        await db
          .getRepository(QuotaLotEntity)
          .findOneByOrFail({ id: allocation.lotId, userId }),
      )
    }
    allocations.sort((a, b) => {
      const x = lots.get(a.lotId)!
      const y = lots.get(b.lotId)!
      return (
        x.expiresAt.localeCompare(y.expiresAt) ||
        x.createdAt.localeCompare(y.createdAt) ||
        x.id.localeCompare(y.id)
      )
    })
    let left = requested
    let charged = 0n
    for (const allocation of allocations) {
      if (!BigInt(allocation.reserved)) {
        continue
      }
      const lot = await db.getRepository(QuotaLotEntity).findOneOrFail({
        where: { id: allocation.lotId, userId },
        lock: { mode: 'pessimistic_write' },
      })
      const held = BigInt(allocation.reserved)
      const debit = left < held ? left : held
      const release = held - debit
      const expired = Date.parse(isoTime(lot.expiresAt)) <= Date.now()
      await db.getRepository(QuotaLotEntity).update(
        { id: lot.id },
        {
          reserved: (BigInt(lot.reserved) - held).toString(),
          consumed: (BigInt(lot.consumed) + (revoke ? 0n : debit)).toString(),
          revoked: (BigInt(lot.revoked) + (revoke ? debit : 0n)).toString(),
          available: (
            BigInt(lot.available) + (expired ? 0n : release)
          ).toString(),
          expired: (BigInt(lot.expired) + (expired ? release : 0n)).toString(),
        },
      )
      await db.getRepository(QuotaAllocationEntity).update(
        { id: allocation.id },
        {
          reserved: '0',
          consumed: (BigInt(allocation.consumed) + debit).toString(),
          released: (BigInt(allocation.released) + release).toString(),
        },
      )
      if (debit) {
        await this.event(
          db,
          lot,
          reference,
          revoke ? 'revoke' : 'consume',
          debit,
        )
      }
      if (release) {
        await this.event(db, lot, reference, 'release', release)
      }
      left -= debit
      charged += debit
    }
    if (allocations.some((row) => BigInt(row.reserved))) {
      await this.touch(db, userId)
    }
    return charged
  }

  async reverse(db: EntityManager, userId: string, reference: string) {
    const allocations = await db.getRepository(QuotaAllocationEntity).find({
      where: { userId, reference },
      lock: { mode: 'pessimistic_write' },
    })
    for (const allocation of allocations) {
      const amount = BigInt(allocation.consumed) - BigInt(allocation.returned)
      if (!amount) {
        continue
      }
      const lot = await db
        .getRepository(QuotaLotEntity)
        .findOneByOrFail({ id: allocation.lotId, userId })
      const expired = Date.parse(isoTime(lot.expiresAt)) <= Date.now()
      await db.getRepository(QuotaLotEntity).update(
        { id: lot.id },
        {
          consumed: (BigInt(lot.consumed) - amount).toString(),
          available: (
            BigInt(lot.available) + (expired ? 0n : amount)
          ).toString(),
          expired: (BigInt(lot.expired) + (expired ? amount : 0n)).toString(),
        },
      )
      await db
        .getRepository(QuotaAllocationEntity)
        .update({ id: allocation.id }, { returned: allocation.consumed })
      await this.event(db, lot, reference, 'reverse', amount)
      await this.touch(db, userId)
    }
  }

  async refundReserve(
    db: EntityManager,
    userId: string,
    orderId: string,
    reference: string,
  ) {
    await this.lock(db, userId)
    const lots = await db
      .getRepository(QuotaLotEntity)
      .find({ where: { userId, orderId }, lock: { mode: 'pessimistic_write' } })
    if (lots.length !== 1 || BigInt(lots[0]!.reserved)) {
      throw ErrorCode.REFUND_BALANCE_USED(
        '订单额度正在使用或权益未找到，请稍后核对',
      )
    }
    const lot = lots[0]!
    const amount = BigInt(lot.available) + BigInt(lot.expired)
    if (!amount) {
      throw ErrorCode.REFUND_BALANCE_USED()
    }
    await db
      .getRepository(QuotaLotEntity)
      .update(
        { id: lot.id },
        { available: '0', expired: '0', reserved: amount.toString() },
      )
    await db.getRepository(QuotaAllocationEntity).insert({
      id: randomUUID(),
      userId,
      reference,
      lotId: lot.id,
      allocated: amount.toString(),
      reserved: amount.toString(),
      consumed: '0',
      released: '0',
      returned: '0',
      createdAt: now(),
    })
    await this.event(db, lot, reference, 'reserve', amount, '退款冻结')
    await this.touch(db, userId)
    return { amount, total: BigInt(lot.total) }
  }

  async lots(db: EntityManager, userId: string): Promise<QuotaLot[]> {
    await this.lock(db, userId)
    await this.expire(db, userId)
    return (
      await db.getRepository(QuotaLotEntity).find({
        where: { userId },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 100,
      })
    ).map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      orderId: row.orderId,
      total: quotaText(BigInt(row.total)),
      available: quotaText(BigInt(row.available)),
      reserved: quotaText(BigInt(row.reserved)),
      consumed: quotaText(BigInt(row.consumed)),
      expired: quotaText(BigInt(row.expired)),
      revoked: quotaText(BigInt(row.revoked)),
      createdAt: isoTime(row.createdAt),
      expiresAt: isoTime(row.expiresAt),
    }))
  }

  async allocations(
    db: EntityManager,
    userId: string,
    reference: string,
  ): Promise<QuotaAllocation[]> {
    const rows = await db
      .getRepository(QuotaAllocationEntity)
      .find({ where: { userId, reference }, order: { createdAt: 'ASC' } })
    const result: QuotaAllocation[] = []
    for (const row of rows) {
      const lot = await db
        .getRepository(QuotaLotEntity)
        .findOne({ select: { name: true }, where: { id: row.lotId, userId } })
      result.push({
        lotId: row.lotId,
        name: lot?.name ?? '资源包',
        reserved: quotaText(BigInt(row.reserved)),
        consumed: quotaText(BigInt(row.consumed) - BigInt(row.returned)),
        returned: quotaText(BigInt(row.returned)),
      })
    }
    return result
  }
}
