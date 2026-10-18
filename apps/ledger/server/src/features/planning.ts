import type {
  BillInput,
  LedgerBudget,
  LedgerNotice,
  LedgerRule,
} from '@t-box/ledger-contracts'
import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { dayjs } from '@t-box/dayjs'
import { invalid } from '@t-box/server-foundation/errors'
import { booleanValue, choice } from '@t-box/server-foundation/input'
import { CategoryEntity } from '../entities.js'
import { amount, cents, money } from '../finance/money.js'
import { isoTime } from '../ledgers/time.js'
import { date, object, text } from '../ledgers/validation.js'
import {
  LedgerBudgetEntity,
  LedgerNoticeEntity,
  LedgerRuleEntity,
} from '../persistence/planning-entities.js'
import { monthBounds, parseBillInput, validateMonth } from '../validation.js'
import { activeAccount } from './account-posting.js'
import { FeatureService, integer, json, notFound, optionalId } from './base.js'
/** Advance from the original anchor so Jan 31 -> Feb 28 -> Mar 31, including leap-day anniversaries. */
export function nextOccurrence(
  start: string,
  frequency: string,
  interval: number,
  after: string,
) {
  const anchor = dayjs.utc(start)
  const unit =
    frequency === 'week' ? 'week' : frequency === 'year' ? 'year' : 'month'
  let n = Math.max(
    1,
    Math.floor(dayjs.utc(after).diff(anchor, unit, true) / interval),
  )
  while (n < 100000) {
    const candidate = anchor.add(n * interval, unit).format('YYYY-MM-DD')
    if (candidate > after) {
      return candidate
    }
    n++
  }
  invalid('frequency', '周期日期超出范围')
}
export class PlanningService extends FeatureService {
  async budgets(actor: Principal, book: string, month: string) {
    await this.read(actor, book)
    validateMonth(month)
    const [start, end] = monthBounds(month)
    // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
    const rows = await this.db.query<
      Pick<LedgerBudget, 'id' | 'month' | 'categoryId' | 'amount' | 'spent'>[]
    >(
      'SELECT b.id,b.budget_month AS month,b.category_id AS categoryId,b.amount,COALESCE((SELECT SUM(s.amount) FROM ledger_daily_categories s WHERE s.ledger_id=b.ledger_id AND s.type=\'expense\' AND s.stat_date BETWEEN ? AND ? AND (b.category_id=\'\' OR s.category_id=b.category_id)),0) AS spent FROM ledger_budgets b WHERE b.ledger_id=? AND b.budget_month=? ORDER BY b.category_id',
      [start, end, book, month],
    )
    return rows.map((r) => ({
      ...r,
      categoryId: r.categoryId || null,
      remaining: money(cents(r.amount) - cents(r.spent)),
      ratio: Math.max(0, Number(cents(r.spent)) / Number(cents(r.amount))),
    }))
  }

  async budget(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['month', 'categoryId', 'amount'])
    const month = validateMonth(v.month)
    if (!month) {
      invalid('month', '请选择月份')
    }
    const cat = optionalId(v.categoryId)
    const sum = amount(v.amount)
    return this.finance.operations.run(
      actor,
      book,
      key,
      'budget.saved',
      v,
      async (db, a) => {
        this.manage(a)
        if (cat) {
          const r = await db
            .getRepository(CategoryEntity)
            .findOne({
              select: { id: true },
              where: { ledgerId: book, id: cat, type: 'expense', active: true },
            })
            .then((row) => (row ? { id: row.id } : null))
          if (!r) {
            invalid('categoryId', '请选择支出分类')
          }
        }
        const id = randomUUID()
        await db
          .createQueryBuilder()
          .insert()
          .into('ledger_budgets')
          .values({
            id: () => ':p0',
            ledger_id: () => ':p1',
            budget_month: () => ':p2',
            category_id: () => ':p3',
            amount: () => ':p4',
            created_by: () => ':p5',
          })
          .updateEntity(false)
          .setParameters({
            p0: id,
            p1: book,
            p2: month,
            p3: cat ?? '',
            p4: sum,
            p5: actor.user.id,
          })
          .orUpdate(['amount'])
          .execute()
        const r = await db.getRepository(LedgerBudgetEntity).findOne({
          select: { id: true },
          where: {
            ledger_id: book,
            budget_month: month,
            category_id: cat ?? '',
          },
        })
        if (!r) {
          notFound()
        }
        return { id: r.id }
      },
    )
  }

  async removeBudget(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'budget.deleted',
      { id },
      async (db, a) => {
        this.manage(a)
        await db
          .getRepository(LedgerBudgetEntity)
          .delete({ ledger_id: book, id })
        return { id }
      },
    )
  }

  async rules(actor: Principal, book: string): Promise<LedgerRule[]> {
    await this.read(actor, book)
    return (
      await this.db
        .createQueryBuilder()
        .select(
          'id,name,bill_json AS bill,frequency,interval_count AS `interval`,start_date AS startDate,next_date AS nextDate,end_date AS endDate,mode,enabled,last_error AS lastError',
        )
        .from('ledger_rules', 'ledger_rules')
        .where('ledger_id=:p0')
        .orderBy('next_date', 'ASC')
        .setParameters({ p0: book })
        .getRawMany<
          Omit<LedgerRule, 'bill' | 'enabled'> & {
            bill: BillInput | string
            enabled: boolean | number
          }
      >()
    ).map((r) => ({
      ...r,
      bill: json<BillInput>(r.bill),
      enabled: !!Number(r.enabled),
    }))
  }

  async createRule(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'name',
      'bill',
      'frequency',
      'interval',
      'startDate',
      'endDate',
      'mode',
    ])
    const name = text(v.name, '规则名称', 60)
    const bill = parseBillInput(v.bill) as BillInput
    const start = date(v.startDate)
    const end = v.endDate === null ? null : date(v.endDate)
    const interval = integer(v.interval, '间隔', 1, 99)
    if (
      !['week', 'month', 'year'].includes(v.frequency as string) ||
      !['remind', 'automatic'].includes(v.mode as string)
    ) {
      invalid('mode', '周期或执行方式无效')
    }
    if (end && end < start) {
      invalid('endDate', '结束日期不能早于开始日期')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'rule.created',
      v,
      async (db, a) => {
        if (a.book.template === 'debt') {
          invalid('template', '往来账本不支持周期收支')
        }
        const c = await db
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
        if (!c) {
          invalid('category', '分类不可用')
        }
        await activeAccount(db, book, bill.accountId)
        const id = randomUUID()
        await db.getRepository(LedgerRuleEntity).insert({
          id,
          ledger_id: book,
          name,
          bill_json: bill,
          frequency: choice(v.frequency, 'frequency', [
            'week',
            'month',
            'year',
          ]),
          interval_count: interval,
          start_date: start,
          next_date: start,
          end_date: end,
          mode: choice(v.mode, 'mode', ['automatic', 'remind']),
          created_by: actor.user.id,
          grant_version: a.book.password_version,
        })
        return {
          id,
          name,
          mode: choice(v.mode, 'mode', ['automatic', 'remind']),
        }
      },
    )
  }

  async toggleRule(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['enabled'])
    if (typeof v.enabled !== 'boolean') {
      invalid('enabled', '请选择状态')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'rule.updated',
      { id, ...v },
      async (db, a) => {
        const r = await db.getRepository(LedgerRuleEntity).findOne({
          select: { id: true, created_by: true },
          where: { ledger_id: book, id },
        })
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        await db.getRepository(LedgerRuleEntity).update(
          { id },
          {
            enabled: booleanValue(v.enabled, 'enabled'),
            last_error: null,
            grant_version: a.book.password_version,
          },
        )
        return { id }
      },
    )
  }

  async notices(actor: Principal, book: string): Promise<LedgerNotice[]> {
    await this.read(actor, book)
    return (
      await this.db
        .createQueryBuilder()
        .select('id,title,body,is_read AS `read`,created_at AS createdAt')
        .from('ledger_notices', 'ledger_notices')
        .where('ledger_id=:p0 AND user_id=:p1')
        .orderBy('created_at', 'DESC')
        .limit(100)
        .setParameters({ p0: book, p1: actor.user.id })
        .getRawMany<
          Omit<LedgerNotice, 'read' | 'createdAt'> & {
            read: number | boolean
            createdAt: Date | string
          }
      >()
    ).map((r) => ({
      ...r,
      read: Boolean(Number(r.read)),
      createdAt: isoTime(r.createdAt),
    }))
  }

  async readNotice(actor: Principal, book: string, id: string) {
    await this.read(actor, book)
    await this.db
      .getRepository(LedgerNoticeEntity)
      .update(
        { ledger_id: book, user_id: actor.user.id, id },
        { is_read: true },
      )
    return { id }
  }
}
