import type {
  LedgerAgingDebt,
  LedgerContact,
  LedgerDebtAdjustment,
  LedgerDebtAdjustmentRecord,
} from '@t-box/ledger-contracts'
import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { choice } from '@t-box/server-foundation/input'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { IsNull } from 'typeorm'
import { DebtPositionEntity } from '../domain-entities.js'
import { amount, cents } from '../finance/money.js'
import { date, note, object, text, today } from '../ledgers/validation.js'
import {
  LedgerContactEntity,
  LedgerDebtAdjustmentEntity,
} from '../persistence/records-entities.js'
import { project } from '../statistics/projection.js'
import { FeatureService, notFound } from './base.js'

export class ContactService extends FeatureService {
  async list(actor: Principal, book: string) {
    await this.read(actor, book)
    // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
    const rows = await this.db.query<
      (Omit<LedgerContact, 'archived'> & { archived: number | boolean })[]
    >(
      'SELECT c.id,c.name,c.note,c.archived,COALESCE(SUM(IF(d.direction=\'receivable\',d.remaining,0)),0) receivable,COALESCE(SUM(IF(d.direction=\'payable\',d.remaining,0)),0) payable FROM ledger_contacts c LEFT JOIN debt_positions d ON d.ledger_id=c.ledger_id AND d.contact_id=c.id WHERE c.ledger_id=? GROUP BY c.id,c.name,c.note,c.archived ORDER BY c.archived,c.name',
      [book],
    )
    return rows.map((row) => ({
      ...row,
      archived: Boolean(Number(row.archived)),
    }))
  }

  async create(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['name', 'note'])
    const name = text(v.name, '往来对象', 80)
    const n = note(v.note)
    return this.finance.operations.run(
      actor,
      book,
      key,
      'contact.created',
      v,
      async (db) => {
        const id = randomUUID()
        await db.getRepository(LedgerContactEntity).insert({
          id,
          ledger_id: book,
          name,
          note: n,
          created_by: actor.user.id,
        })
        await db
          .getRepository(DebtPositionEntity)
          .update(
            { ledgerId: book, counterparty: name, contactId: IsNull() },
            { contactId: id },
          )
        return { id, name, note: n }
      },
    )
  }

  async update(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['name', 'note', 'archived'])
    return this.finance.operations.run(
      actor,
      book,
      key,
      'contact.updated',
      { id, ...v },
      async (db, a) => {
        this.manage(a)
        const r = await db.getRepository(LedgerContactEntity).findOne({
          select: {
            id: true,
            ledger_id: true,
            name: true,
            note: true,
            archived: true,
            created_by: true,
            created_at: true,
          },
          where: { ledger_id: book, id },
        })
        if (!r) {
          notFound()
        }
        if (v.archived !== undefined && typeof v.archived !== 'boolean') {
          invalid('archived', '状态无效')
        }
        const name =
          v.name === undefined ? r.name : text(v.name, '往来对象', 80)
        await db.getRepository(LedgerContactEntity).update(
          { id },
          {
            name,
            note: v.note === undefined ? r.note : note(v.note),
            archived: v.archived ?? r.archived,
          },
        )
        await db
          .getRepository(DebtPositionEntity)
          .update({ ledgerId: book, contactId: id }, { counterparty: name })
        return { id }
      },
    )
  }

  async aging(actor: Principal, book: string) {
    await this.read(actor, book)
    return this.db
      .createQueryBuilder()
      .select(
        'id,contact_id AS contactId,counterparty,direction,amount,settled,adjusted,remaining,due_date AS dueDate,GREATEST(0,DATEDIFF(:p0,due_date)) AS overdueDays,CASE WHEN due_date IS NULL OR due_date>=:p1 THEN \'not_due\' WHEN DATEDIFF(:p2,due_date)<=30 THEN \'1_30\' WHEN DATEDIFF(:p3,due_date)<=90 THEN \'31_90\' ELSE \'over_90\' END AS bucket',
      )
      .from('debt_positions', 'debt_positions')
      .where('ledger_id=:p4 AND remaining>0')
      .orderBy('due_date IS NULL', 'ASC')
      .addOrderBy('due_date', 'ASC')
      .addOrderBy('occurred_date', 'ASC')
      .setParameters({
        p0: today(),
        p1: today(),
        p2: today(),
        p3: today(),
        p4: book,
      })
      .getRawMany<LedgerAgingDebt>()
  }

  async adjust(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'kind',
      'amount',
      'date',
      'note',
      'dueDate',
      'attachmentResourceIds',
    ])
    const n = text(v.note, '调整原因', 200)
    if (!['extension', 'waiver', 'writeoff'].includes(v.kind as string)) {
      invalid('kind', '调整类型无效')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'debt.adjusted',
      { id, ...v },
      async (db, a) => {
        this.manage(a)
        const r = await db
          .getRepository(DebtPositionEntity)
          .findOne({
            select: {
              accountId: true,
              contactId: true,
              adjusted: true,
              id: true,
              ledgerId: true,
              direction: true,
              counterparty: true,
              amount: true,
              settled: true,
              remaining: true,
              date: true,
              dueDate: true,
              note: true,
              cashMovement: true,
              createdBy: true,
              createdAt: true,
            },
            where: { ledgerId: book, id },
          })
          .then((row) =>
            row
              ? {
                  account_id: row.accountId,
                  contact_id: row.contactId,
                  adjusted: row.adjusted,
                  id: row.id,
                  ledger_id: row.ledgerId,
                  direction: row.direction,
                  counterparty: row.counterparty,
                  amount: row.amount,
                  settled: row.settled,
                  remaining: row.remaining,
                  occurred_date: row.date,
                  due_date: row.dueDate,
                  note: row.note,
                  cash_movement: row.cashMovement,
                  created_by: row.createdBy,
                  created_at: sqlClock(row.createdAt),
                }
              : null,
          )
        if (!r) {
          notFound()
        }
        if (v.kind === 'extension') {
          const due = date(v.dueDate)
          if (due < r.occurred_date) {
            invalid('dueDate', '到期日不能早于发生日')
          }
          await db
            .getRepository(DebtPositionEntity)
            .update({ id }, { dueDate: due })
          return { id, dueDate: due }
        }
        const sum = amount(v.amount)
        const d = date(v.date)
        if (d < r.occurred_date || d > today()) {
          invalid('date', '调整日期无效')
        }
        if (cents(sum) > cents(r.remaining)) {
          invalid('amount', '减免或核销不能超过剩余金额')
        }
        const adjustment = randomUUID()
        await db.getRepository(LedgerDebtAdjustmentEntity).insert({
          id: adjustment,
          ledger_id: book,
          debt_id: id,
          kind: choice(v.kind, 'kind', ['extension', 'waiver', 'writeoff']),
          amount: sum,
          adjustment_date: d,
          note: n,
          created_by: actor.user.id,
        })
        await db
          .createQueryBuilder()
          .update('debt_positions')
          .set({
            adjusted: () => 'adjusted+:p0',
            remaining: () => 'remaining-:p1',
          })
          .updateEntity(false)
          .where('id=:p2')
          .setParameters({ p0: sum, p1: sum, p2: id })
          .execute()
        await project(db, book, {
          subjectId: adjustment,
          kind: 'writeoff',
          date: d,
          note: n,
          createdBy: actor.user.id,
          ...(r.direction === 'receivable'
            ? { receivable: -cents(sum) }
            : { payable: -cents(sum) }),
        })
        return { id: adjustment, debtId: id }
      },
    )
  }

  async adjustments(actor: Principal, book: string) {
    await this.read(actor, book)
    const rows = await this.db
      .createQueryBuilder()
      .select(
        'a.id,a.debt_id AS debtId,a.kind,a.amount,a.adjustment_date AS date,a.note,a.reversed,d.counterparty,d.direction',
      )
      .from('ledger_debt_adjustments', 'a')
      .innerJoin('debt_positions', 'd', 'd.id=a.debt_id')
      .where('a.ledger_id=:p0')
      .orderBy('a.created_at', 'DESC')
      .limit(1000)
      .setParameters({ p0: book })
      .getRawMany<
        Omit<LedgerDebtAdjustmentRecord, 'reversed'> & {
          reversed: number | boolean
        }
    >()
    return rows.map((row) => ({
      ...row,
      reversed: Boolean(Number(row.reversed)),
    }))
  }

  async history(
    actor: Principal,
    book: string,
    id: string,
  ): Promise<LedgerDebtAdjustment[]> {
    await this.read(actor, book)
    return this.db
      .getRepository(LedgerDebtAdjustmentEntity)
      .find({
        select: {
          id: true,
          kind: true,
          amount: true,
          adjustment_date: true,
          note: true,
          reversed: true,
        },
        where: { ledger_id: book, debt_id: id },
        order: { created_at: 'DESC' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          amount: row.amount,
          date: row.adjustment_date,
          note: row.note,
          reversed: Boolean(Number(row.reversed)),
        })),
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
      'debt.adjustment_reversed',
      { id },
      async (db, a) => {
        this.manage(a)
        const [r] = await db
          .createQueryBuilder()
          .select(
            'a.id,a.ledger_id,a.debt_id,a.kind,a.amount,a.adjustment_date,a.note,a.reversed,a.created_by,a.created_at,d.direction',
          )
          .from('ledger_debt_adjustments', 'a')
          .innerJoin('debt_positions', 'd', 'd.id=a.debt_id')
          .where('a.ledger_id=:p0 AND a.id=:p1')
          .setParameters({ p0: book, p1: id })
          .getRawMany()
        if (!r) {
          notFound()
        }
        if (Number(r.reversed)) {
          return { id }
        }
        await db
          .getRepository(LedgerDebtAdjustmentEntity)
          .update({ id }, { reversed: true })
        await db
          .createQueryBuilder()
          .update('debt_positions')
          .set({
            adjusted: () => 'adjusted-:p0',
            remaining: () => 'remaining+:p1',
          })
          .updateEntity(false)
          .where('id=:p2')
          .setParameters({ p0: r.amount, p1: r.amount, p2: r.debt_id })
          .execute()
        await project(db, book, {
          subjectId: id,
          kind: 'correction',
          date: r.adjustment_date,
          note: '撤销减免/核销',
          createdBy: actor.user.id,
          ...(r.direction === 'receivable'
            ? { receivable: cents(r.amount) }
            : { payable: cents(r.amount) }),
        })
        return { id }
      },
    )
  }
}
