import type {
  LedgerReimbursement,
  LedgerReimbursementReceipt,
} from '@t-box/ledger-contracts'
import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { IsNull } from 'typeorm'
import { BillEntity } from '../entities.js'
import { amount, cents } from '../finance/money.js'
import { date, note, object, text } from '../ledgers/validation.js'
import {
  LedgerRefundEntity,
  LedgerReimbursementEntity,
  LedgerReimbursementReceiptEntity,
} from '../persistence/refunds-entities.js'
import { project } from '../statistics/projection.js'
import { parseId } from '../validation.js'
import { activeAccount, postAccount } from './account-posting.js'
import { FeatureService, notFound, optionalId } from './base.js'

export class RefundService extends FeatureService {
  async create(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'billId',
      'amount',
      'date',
      'note',
      'accountId',
      'attachmentResourceIds',
    ])
    const billId = parseId(v.billId)
    const sum = amount(v.amount)
    const d = date(v.date)
    const n = note(v.note)
    const account = optionalId(v.accountId)
    return this.finance.operations.run(
      actor,
      book,
      key,
      'refund.created',
      v,
      async (db) => {
        const r = await db
          .getRepository(BillEntity)
          .findOne({
            select: {
              id: true,
              ledgerId: true,
              createdBy: true,
              accountId: true,
              deletedAt: true,
              type: true,
              amount: true,
              category: true,
              date: true,
              note: true,
              createdAt: true,
              updatedAt: true,
            },
            where: { ledgerId: book, id: billId, deletedAt: IsNull() },
          })
          .then((row) =>
            row
              ? {
                  id: row.id,
                  ledger_id: row.ledgerId,
                  created_by: row.createdBy,
                  account_id: row.accountId,
                  deleted_at:
                    row.deletedAt === null ? null : sqlClock(row.deletedAt),
                  type: row.type,
                  amount: row.amount,
                  category: row.category,
                  bill_date: row.date,
                  note: row.note,
                  created_at: sqlClock(row.createdAt),
                  updated_at: sqlClock(row.updatedAt),
                }
              : null,
          )
        if (!r || r.type !== 'expense') {
          invalid('billId', '请选择此账本的支出账单')
        }
        if (d < r.bill_date) {
          invalid('date', '退款日期不能早于消费日期')
        }
        // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
        const [total] = await db.query(
          'SELECT (SELECT COALESCE(SUM(amount),0) FROM ledger_refunds WHERE ledger_id=? AND bill_id=? AND reversed=FALSE)+(SELECT COALESCE(SUM(amount),0) FROM ledger_reimbursements WHERE ledger_id=? AND bill_id=? AND status<>\'cancelled\') AS amount',
          [book, billId, book, billId],
        )
        if (cents(total.amount) + cents(sum) > cents(r.amount)) {
          invalid('amount', '退款与申请报销合计不能超过原支出')
        }
        await activeAccount(db, book, account)
        const id = randomUUID()
        await db.getRepository(LedgerRefundEntity).insert({
          id,
          ledger_id: book,
          bill_id: billId,
          amount: sum,
          refund_date: d,
          note: n,
          account_id: account,
          created_by: actor.user.id,
        })
        await project(db, book, {
          subjectId: id,
          kind: 'refund',
          date: d,
          note: n,
          createdBy: actor.user.id,
          expense: -cents(sum),
          cashIn: cents(sum),
          categoryId: r.category,
          billType: 'expense',
          count: 0,
        })
        await postAccount(
          db,
          book,
          account,
          id,
          d,
          cents(sum),
          n,
          actor.user.id,
        )
        return { id, billId, amount: sum, date: d, note: n }
      },
    )
  }

  async reverse(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'refund.reversed',
      { id },
      async (db, a) => {
        const [r] = await db
          .createQueryBuilder()
          .select(
            'r.id,r.ledger_id,r.bill_id,r.amount,r.refund_date,r.note,r.account_id,r.reversed,r.created_by,r.created_at,b.category',
          )
          .from('ledger_refunds', 'r')
          .innerJoin('bills', 'b', 'b.id=r.bill_id')
          .where('r.ledger_id=:p0 AND r.id=:p1')
          .setParameters({ p0: book, p1: id })
          .getRawMany()
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        if (Number(r.reversed)) {
          return { id }
        }
        await db
          .getRepository(LedgerRefundEntity)
          .update({ id }, { reversed: true })
        await project(db, book, {
          subjectId: id,
          kind: 'correction',
          date: r.refund_date,
          note: '撤销退款',
          createdBy: actor.user.id,
          expense: cents(r.amount),
          cashIn: -cents(r.amount),
          categoryId: r.category,
          billType: 'expense',
        })
        await postAccount(
          db,
          book,
          r.account_id,
          id,
          r.refund_date,
          -cents(r.amount),
          '撤销退款',
          actor.user.id,
        )
        return { id }
      },
    )
  }

  async reimburse(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'billId',
      'counterparty',
      'amount',
      'attachmentResourceIds',
    ])
    const billId = parseId(v.billId)
    const sum = amount(v.amount)
    const party = text(v.counterparty, '报销方', 80)
    return this.finance.operations.run(
      actor,
      book,
      key,
      'reimbursement.requested',
      v,
      async (db) => {
        const b = await db
          .getRepository(BillEntity)
          .findOne({
            select: {
              id: true,
              ledgerId: true,
              createdBy: true,
              accountId: true,
              deletedAt: true,
              type: true,
              amount: true,
              category: true,
              date: true,
              note: true,
              createdAt: true,
              updatedAt: true,
            },
            where: {
              ledgerId: book,
              id: billId,
              deletedAt: IsNull(),
              type: 'expense',
            },
          })
          .then((row) =>
            row
              ? {
                  id: row.id,
                  ledger_id: row.ledgerId,
                  created_by: row.createdBy,
                  account_id: row.accountId,
                  deleted_at:
                    row.deletedAt === null ? null : sqlClock(row.deletedAt),
                  type: row.type,
                  amount: row.amount,
                  category: row.category,
                  bill_date: row.date,
                  note: row.note,
                  created_at: sqlClock(row.createdAt),
                  updated_at: sqlClock(row.updatedAt),
                }
              : null,
          )
        if (!b) {
          invalid('billId', '请选择支出账单')
        }
        // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
        const [t] = await db.query(
          'SELECT (SELECT COALESCE(SUM(amount),0) FROM ledger_refunds WHERE ledger_id=? AND bill_id=? AND reversed=FALSE)+(SELECT COALESCE(SUM(amount),0) FROM ledger_reimbursements WHERE ledger_id=? AND bill_id=? AND status<>\'cancelled\') AS amount',
          [book, billId, book, billId],
        )
        if (cents(t.amount) + cents(sum) > cents(b.amount)) {
          invalid('amount', '报销与退款合计不能超过原支出')
        }
        const id = randomUUID()
        await db.getRepository(LedgerReimbursementEntity).insert({
          id,
          ledger_id: book,
          bill_id: billId,
          counterparty: party,
          amount: sum,
          created_by: actor.user.id,
        })
        await project(db, book, {
          subjectId: id,
          kind: 'reimbursement',
          date: b.bill_date,
          note: '申请报销',
          createdBy: actor.user.id,
          receivable: cents(sum),
        })
        return {
          id,
          billId,
          amount: sum,
          received: '0.00',
          status: 'requested',
        }
      },
    )
  }

  async receive(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'amount',
      'date',
      'accountId',
      'note',
      'attachmentResourceIds',
    ])
    const sum = amount(v.amount)
    const d = date(v.date)
    const account = optionalId(v.accountId)
    const n = note(v.note)
    return this.finance.operations.run(
      actor,
      book,
      key,
      'reimbursement.received',
      { id, ...v },
      async (db) => {
        const [r] = await db
          .createQueryBuilder()
          .select(
            'r.id,r.ledger_id,r.bill_id,r.counterparty,r.amount,r.received,r.status,r.created_by,r.created_at,b.category,b.bill_date',
          )
          .from('ledger_reimbursements', 'r')
          .innerJoin('bills', 'b', 'b.id=r.bill_id')
          .where('r.ledger_id=:p0 AND r.id=:p1')
          .setParameters({ p0: book, p1: id })
          .getRawMany()
        if (!r) {
          notFound()
        }
        if (r.status === 'cancelled') {
          invalid('reimbursement', '报销申请已取消')
        }
        if (cents(sum) + cents(r.received) > cents(r.amount)) {
          invalid('amount', '收款超过未报销金额')
        }
        if (d < r.bill_date) {
          invalid('date', '收款不能早于原支出')
        }
        await activeAccount(db, book, account)
        const receipt = randomUUID()
        await db.getRepository(LedgerReimbursementReceiptEntity).insert({
          id: receipt,
          ledger_id: book,
          reimbursement_id: id,
          amount: sum,
          receipt_date: d,
          account_id: account,
          note: n,
          created_by: actor.user.id,
        })
        await db
          .createQueryBuilder()
          .update('ledger_reimbursements')
          .set({
            received: () => 'received+:p0',
            status: () => 'IF(received=amount,\'received\',\'partial\')',
          })
          .updateEntity(false)
          .where('id=:p1')
          .setParameters({ p0: sum, p1: id })
          .execute()
        await project(db, book, {
          subjectId: receipt,
          kind: 'reimbursement',
          date: d,
          note: n,
          createdBy: actor.user.id,
          expense: -cents(sum),
          cashIn: cents(sum),
          receivable: -cents(sum),
          categoryId: r.category,
          billType: 'expense',
        })
        await postAccount(
          db,
          book,
          account,
          receipt,
          d,
          cents(sum),
          n,
          actor.user.id,
        )
        return { id: receipt, reimbursementId: id, amount: sum }
      },
    )
  }

  async receipts(
    actor: Principal,
    book: string,
    id: string,
  ): Promise<LedgerReimbursementReceipt[]> {
    await this.read(actor, book)
    return this.db
      .getRepository(LedgerReimbursementReceiptEntity)
      .find({
        select: {
          id: true,
          amount: true,
          receipt_date: true,
          account_id: true,
          note: true,
          reversed: true,
          created_by: true,
        },
        where: { ledger_id: book, reimbursement_id: id },
        order: { created_at: 'DESC' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          amount: row.amount,
          date: row.receipt_date,
          accountId: row.account_id,
          note: row.note,
          reversed: Boolean(Number(row.reversed)),
          createdBy: row.created_by,
        })),
      )
  }

  async reverseReceipt(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'reimbursement.receipt_reversed',
      { id },
      async (db, a) => {
        const [r] = await db
          .createQueryBuilder()
          .select(
            't.id,t.ledger_id,t.reimbursement_id,t.amount,t.receipt_date,t.account_id,t.note,t.reversed,t.created_by,t.created_at,r.bill_id,b.category',
          )
          .from('ledger_reimbursement_receipts', 't')
          .innerJoin('ledger_reimbursements', 'r', 'r.id=t.reimbursement_id')
          .innerJoin('bills', 'b', 'b.id=r.bill_id')
          .where('t.ledger_id=:p0 AND t.id=:p1')
          .setParameters({ p0: book, p1: id })
          .getRawMany()
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        if (Number(r.reversed)) {
          return { id }
        }
        await db
          .getRepository(LedgerReimbursementReceiptEntity)
          .update({ id }, { reversed: true })
        await db
          .createQueryBuilder()
          .update('ledger_reimbursements')
          .set({
            received: () => 'received-:p0',
            status: () => 'IF(received=0,\'requested\',\'partial\')',
          })
          .updateEntity(false)
          .where('id=:p1')
          .setParameters({ p0: r.amount, p1: r.reimbursement_id })
          .execute()
        await project(db, book, {
          subjectId: id,
          kind: 'correction',
          date: r.receipt_date,
          note: '撤销报销到账',
          createdBy: actor.user.id,
          expense: cents(r.amount),
          cashIn: -cents(r.amount),
          receivable: cents(r.amount),
          categoryId: r.category,
          billType: 'expense',
        })
        await postAccount(
          db,
          book,
          r.account_id,
          id,
          r.receipt_date,
          -cents(r.amount),
          '撤销报销到账',
          actor.user.id,
        )
        return { id }
      },
    )
  }

  async cancel(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'reimbursement.cancelled',
      { id },
      async (db, a) => {
        const [r] = await db
          .createQueryBuilder()
          .select(
            'r.id,r.ledger_id,r.bill_id,r.counterparty,r.amount,r.received,r.status,r.created_by,r.created_at,b.bill_date',
          )
          .from('ledger_reimbursements', 'r')
          .innerJoin('bills', 'b', 'b.id=r.bill_id')
          .where('r.ledger_id=:p0 AND r.id=:p1')
          .setParameters({ p0: book, p1: id })
          .getRawMany()
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        if (r.status === 'cancelled') {
          return { id }
        }
        if (cents(r.received) > 0n) {
          invalid('reimbursement', '请先撤销所有到账记录，再取消报销申请')
        }
        await db
          .getRepository(LedgerReimbursementEntity)
          .update({ id }, { status: 'cancelled' })
        await project(db, book, {
          subjectId: id,
          kind: 'correction',
          date: r.bill_date,
          note: '取消报销申请',
          createdBy: actor.user.id,
          receivable: -cents(r.amount),
        })
        return { id }
      },
    )
  }

  async listReimbursements(
    actor: Principal,
    book: string,
  ): Promise<LedgerReimbursement[]> {
    await this.read(actor, book)
    return this.db
      .getRepository(LedgerReimbursementEntity)
      .find({
        select: {
          id: true,
          bill_id: true,
          counterparty: true,
          amount: true,
          received: true,
          status: true,
          created_by: true,
        },
        where: { ledger_id: book },
        order: { created_at: 'DESC' },
        take: 1000,
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          billId: row.bill_id,
          counterparty: row.counterparty,
          amount: row.amount,
          received: row.received,
          status: row.status,
          createdBy: row.created_by,
        })),
      )
  }
}
