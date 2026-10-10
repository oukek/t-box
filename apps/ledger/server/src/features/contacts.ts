import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { amount, cents } from '../finance/money.js'
import { date, note, object, text, today } from '../ledgers/validation.js'
import { project } from '../statistics/projection.js'
import { FeatureService, notFound } from './base.js'

export class ContactService extends FeatureService {
  async list(actor: Principal, book: string) {
    await this.read(actor, book)
    return this.db.query(
      'SELECT c.id,c.name,c.note,c.archived,COALESCE(SUM(IF(d.direction=\'receivable\',d.remaining,0)),0) receivable,COALESCE(SUM(IF(d.direction=\'payable\',d.remaining,0)),0) payable FROM ledger_contacts c LEFT JOIN debt_positions d ON d.ledger_id=c.ledger_id AND d.contact_id=c.id WHERE c.ledger_id=? GROUP BY c.id,c.name,c.note,c.archived ORDER BY c.archived,c.name',
      [book],
    )
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
        await db.query(
          'INSERT INTO ledger_contacts(id,ledger_id,name,note,created_by) VALUES(?,?,?,?,?)',
          [id, book, name, n, actor.user.id],
        )
        await db.query(
          'UPDATE debt_positions SET contact_id=? WHERE ledger_id=? AND counterparty=? AND contact_id IS NULL',
          [id, book, name],
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
        const [r] = await db.query(
          'SELECT * FROM ledger_contacts WHERE ledger_id=? AND id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        if (v.archived !== undefined && typeof v.archived !== 'boolean') {
          invalid('archived', '状态无效')
        }
        const name =
          v.name === undefined ? r.name : text(v.name, '往来对象', 80)
        await db.query(
          'UPDATE ledger_contacts SET name=?,note=?,archived=? WHERE id=?',
          [
            name,
            v.note === undefined ? r.note : note(v.note),
            v.archived ?? r.archived,
            id,
          ],
        )
        await db.query(
          'UPDATE debt_positions SET counterparty=? WHERE ledger_id=? AND contact_id=?',
          [name, book, id],
        )
        return { id }
      },
    )
  }

  async aging(actor: Principal, book: string) {
    await this.read(actor, book)
    return this.db.query(
      'SELECT id,contact_id AS contactId,counterparty,direction,amount,settled,adjusted,remaining,due_date AS dueDate,GREATEST(0,DATEDIFF(?,due_date)) AS overdueDays,CASE WHEN due_date IS NULL OR due_date>=? THEN \'not_due\' WHEN DATEDIFF(?,due_date)<=30 THEN \'1_30\' WHEN DATEDIFF(?,due_date)<=90 THEN \'31_90\' ELSE \'over_90\' END AS bucket FROM debt_positions WHERE ledger_id=? AND remaining>0 ORDER BY due_date IS NULL,due_date,occurred_date',
      [today(), today(), today(), today(), book],
    )
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
        const [r] = await db.query(
          'SELECT * FROM debt_positions WHERE ledger_id=? AND id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        if (v.kind === 'extension') {
          const due = date(v.dueDate)
          if (due < r.occurred_date) {
            invalid('dueDate', '到期日不能早于发生日')
          }
          await db.query('UPDATE debt_positions SET due_date=? WHERE id=?', [
            due,
            id,
          ])
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
        await db.query(
          'INSERT INTO ledger_debt_adjustments(id,ledger_id,debt_id,kind,amount,adjustment_date,note,created_by) VALUES(?,?,?,?,?,?,?,?)',
          [adjustment, book, id, v.kind, sum, d, n, actor.user.id],
        )
        await db.query(
          'UPDATE debt_positions SET adjusted=adjusted+?,remaining=remaining-? WHERE id=?',
          [sum, sum, id],
        )
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
    return this.db.query(
      'SELECT a.id,a.debt_id AS debtId,a.kind,a.amount,a.adjustment_date AS date,a.note,a.reversed,d.counterparty,d.direction FROM ledger_debt_adjustments a JOIN debt_positions d ON d.id=a.debt_id WHERE a.ledger_id=? ORDER BY a.created_at DESC LIMIT 1000',
      [book],
    )
  }

  async history(actor: Principal, book: string, id: string) {
    await this.read(actor, book)
    return this.db.query(
      'SELECT id,kind,amount,adjustment_date AS date,note,reversed FROM ledger_debt_adjustments WHERE ledger_id=? AND debt_id=? ORDER BY created_at DESC',
      [book, id],
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
        const [r] = await db.query(
          'SELECT a.*,d.direction FROM ledger_debt_adjustments a JOIN debt_positions d ON d.id=a.debt_id WHERE a.ledger_id=? AND a.id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        if (Number(r.reversed)) {
          return { id }
        }
        await db.query(
          'UPDATE ledger_debt_adjustments SET reversed=TRUE WHERE id=?',
          [id],
        )
        await db.query(
          'UPDATE debt_positions SET adjusted=adjusted-?,remaining=remaining+? WHERE id=?',
          [r.amount, r.amount, r.debt_id],
        )
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
