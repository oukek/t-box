import type {
  BillInput,
  LedgerBillDetail,
  LedgerTrashBill,
} from '@t-box/ledger-contracts'
import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { IsNull, Not } from 'typeorm'
import { BillEntity, CategoryEntity } from '../entities.js'
import { billDelta } from '../finance/service.js'
import { isoTime } from '../ledgers/time.js'
import { object, text } from '../ledgers/validation.js'
import { LedgerTemplateEntity } from '../persistence/records-entities.js'
import {
  LedgerRefundEntity,
  LedgerReimbursementEntity,
} from '../persistence/refunds-entities.js'
import { parseBillInput, parseId } from '../validation.js'
import { activeAccount } from './account-posting.js'
import { FeatureService, json, notFound } from './base.js'

export class RecordService extends FeatureService {
  async detail(
    actor: Principal,
    book: string,
    id: string,
  ): Promise<LedgerBillDetail> {
    const bill = await this.finance.getBill(actor, book, id)
    const history = await this.db
      .createQueryBuilder()
      .select(
        'a.id,a.action,a.details,a.created_at AS createdAt,u.nickname AS actor',
      )
      .from('ledger_audit', 'a')
      .leftJoin('app_users', 'u', 'u.id=a.user_id')
      .where('a.ledger_id=:p0 AND a.subject_id=:p1')
      .orderBy('a.created_at', 'DESC')
      .limit(100)
      .setParameters({ p0: book, p1: id })
      .getRawMany<
        Omit<LedgerBillDetail['history'][number], 'createdAt'> & {
          createdAt: Date | string
        }
    >()
    const refunds = await this.db
      .getRepository(LedgerRefundEntity)
      .find({
        select: {
          id: true,
          amount: true,
          refund_date: true,
          note: true,
          reversed: true,
        },
        where: { ledger_id: book, bill_id: id },
        order: { created_at: 'ASC' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          amount: row.amount,
          date: row.refund_date,
          note: row.note,
          reversed: Boolean(Number(row.reversed)),
        })),
      )
    const reimbursements = await this.db
      .getRepository(LedgerReimbursementEntity)
      .find({
        select: {
          id: true,
          counterparty: true,
          amount: true,
          received: true,
          status: true,
        },
        where: { ledger_id: book, bill_id: id },
      })
    const creator = bill.createdBy
      ? await this.db
          .getRepository(AppUserEntity)
          .findOne({
            select: { nickname: true },
            where: { id: bill.createdBy },
          })
          .then((row) => (row ? { nickname: row.nickname } : null))
      : null
    return {
      bill,
      creator: creator?.nickname ?? '已注销用户',
      history: history.map((r) => ({
        ...r,
        createdAt: isoTime(r.createdAt),
      })),
      refunds,
      reimbursements,
    }
  }

  async trash(actor: Principal, book: string): Promise<LedgerTrashBill[]> {
    await this.read(actor, book)
    return (
      await this.db
        .getRepository(BillEntity)
        .find({
          select: {
            id: true,
            type: true,
            amount: true,
            category: true,
            date: true,
            note: true,
            deletedAt: true,
            createdBy: true,
          },
          where: { ledgerId: book, deletedAt: Not(IsNull()) },
          order: { deletedAt: 'DESC' },
          take: 1000,
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            type: row.type,
            amount: row.amount,
            category: row.category,
            date: row.date,
            note: row.note,
            deletedAt: row.deletedAt === null ? null : sqlClock(row.deletedAt),
            createdBy: row.createdBy,
          })),
        )
    ).map((r) => ({
      ...r,
      deletedAt: r.deletedAt === null ? null : isoTime(r.deletedAt),
    }))
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
            where: { ledgerId: book, id },
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
        await db
          .getRepository(BillEntity)
          .update(
            { id },
            { deletedAt: null, updatedAt: () => 'UTC_TIMESTAMP(3)' },
          )
        await billDelta(db, book, bill, actor.user.id)
        return { id }
      },
    )
  }

  async templates(actor: Principal, book: string) {
    await this.read(actor, book)
    return (
      await this.db
        .getRepository(LedgerTemplateEntity)
        .find({
          select: { id: true, name: true, bill_json: true },
          where: { ledger_id: book },
          order: { created_at: 'DESC' },
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            bill: row.bill_json,
          })),
        )
    ).map((r) => ({ ...r, bill: json<BillInput>(r.bill) }))
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
        const category = await db
          .getRepository(CategoryEntity)
          .findOne({
            select: { id: true },
            where: {
              ledgerId: book,
              id: bill.category,
              type: bill.type,
              active: true,
            },
          })
          .then((row) => (row ? { id: row.id } : null))
        if (!category) {
          invalid('category', '分类无效')
        }
        const id = randomUUID()
        await db.getRepository(LedgerTemplateEntity).insert({
          id,
          ledger_id: book,
          name,
          bill_json: bill,
          created_by: actor.user.id,
        })
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
        const r = await db.getRepository(LedgerTemplateEntity).findOne({
          select: { id: true, created_by: true },
          where: { ledger_id: book, id },
        })
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        await db.getRepository(LedgerTemplateEntity).delete({ id })
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
