import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { billDelta } from '../finance/service.js'
import { isoTime } from '../ledgers/time.js'
import { object, text } from '../ledgers/validation.js'
import { parseBillInput, parseId } from '../validation.js'
import { activeAccount } from './account-posting.js'
import { FeatureService, json, notFound } from './base.js'

export class RecordService extends FeatureService {
  async detail(actor: Principal, book: string, id: string) {
    const bill = await this.finance.getBill(actor, book, id)
    const history = await this.db.query(
      'SELECT a.id,a.action,a.details,a.created_at AS createdAt,u.nickname AS actor FROM ledger_audit a LEFT JOIN app_users u ON u.id=a.user_id WHERE a.ledger_id=? AND a.subject_id=? ORDER BY a.created_at DESC LIMIT 100',
      [book, id],
    )
    const refunds = await this.db.query(
      'SELECT id,amount,refund_date AS date,note,reversed FROM ledger_refunds WHERE ledger_id=? AND bill_id=? ORDER BY created_at',
      [book, id],
    )
    const reimbursements = await this.db.query(
      'SELECT id,counterparty,amount,received,status FROM ledger_reimbursements WHERE ledger_id=? AND bill_id=?',
      [book, id],
    )
    const [creator] = await this.db.query(
      'SELECT nickname FROM app_users WHERE id=?',
      [bill.createdBy],
    )
    return {
      bill,
      creator: creator?.nickname ?? '已注销用户',
      history: history.map((r: any) => ({
        ...r,
        createdAt: isoTime(r.createdAt),
      })),
      refunds,
      reimbursements,
    }
  }

  async trash(actor: Principal, book: string) {
    await this.read(actor, book)
    return (
      await this.db.query(
        'SELECT id,type,amount,category,bill_date AS date,note,deleted_at AS deletedAt,created_by AS createdBy FROM bills WHERE ledger_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1000',
        [book],
      )
    ).map((r: any) => ({ ...r, deletedAt: isoTime(r.deletedAt) }))
  }

  async restore(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'bill.restored',
      { id },
      async (db, a) => {
        const [r] = await db.query(
          'SELECT * FROM bills WHERE ledger_id=? AND id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        if (!r.deleted_at) {
          return { id }
        }
        const bill = {
          id: r.id,
          type: r.type,
          amount: r.amount,
          category: r.category,
          date: r.bill_date,
          note: r.note,
          accountId: r.account_id,
          createdAt: '',
          updatedAt: '',
        }
        await db.query(
          'UPDATE bills SET deleted_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
          [id],
        )
        await billDelta(db, book, bill, actor.user.id)
        return { id }
      },
    )
  }

  async templates(actor: Principal, book: string) {
    await this.read(actor, book)
    return (
      await this.db.query(
        'SELECT id,name,bill_json AS bill FROM ledger_templates WHERE ledger_id=? ORDER BY created_at DESC',
        [book],
      )
    ).map((r: any) => ({ ...r, bill: json(r.bill) }))
  }

  async saveTemplate(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['name', 'bill'])
    const name = text(v.name, '模板名称', 60)
    const bill = parseBillInput(v.bill)
    return this.finance.operations.run(
      actor,
      book,
      key,
      'template.created',
      { name, bill },
      async (db, a) => {
        if (a.book.template === 'debt') {
          invalid('template', '往来账本不支持收支模板')
        }
        await activeAccount(db, book, bill.accountId)
        const [category] = await db.query(
          'SELECT id FROM bill_categories WHERE ledger_id=? AND id=? AND type=? AND active=TRUE',
          [book, bill.category, bill.type],
        )
        if (!category) {
          invalid('category', '分类无效')
        }
        const id = randomUUID()
        await db.query(
          'INSERT INTO ledger_templates(id,ledger_id,name,bill_json,created_by) VALUES(?,?,?,?,?)',
          [id, book, name, JSON.stringify(bill), actor.user.id],
        )
        return { id, name, bill }
      },
    )
  }

  async removeTemplate(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'template.deleted',
      { id },
      async (db, a) => {
        const [r] = await db.query(
          'SELECT created_by FROM ledger_templates WHERE ledger_id=? AND id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        await db.query('DELETE FROM ledger_templates WHERE id=?', [id])
        return { id }
      },
    )
  }

  async batchCategory(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['billIds', 'categoryId'])
    const cat = parseId(v.categoryId)
    if (
      !Array.isArray(v.billIds) ||
      !v.billIds.length ||
      v.billIds.length > 100
    ) {
      invalid('billIds', '请选择 1–100 笔记录')
    }
    const ids = v.billIds.map(parseId)
    if (new Set(ids).size !== ids.length) {
      invalid('billIds', '记录不能重复')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'bills.recategorized',
      { ids, cat },
      async () => {
        const result = []
        const operation = randomUUID()
        for (let i = 0; i < ids.length; i++) {
          result.push(
            await this.finance.updateBill(
              actor,
              book,
              ids[i]!,
              `categories:${operation}:${i}`,
              {
                category: cat,
              },
            ),
          )
        }
        return { count: result.length }
      },
    )
  }
}
