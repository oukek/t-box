import type {
  Bill,
  BillCategory,
  BillInput,
  BillSummary,
  Debt,
  Settlement,
} from '@t-box/ledger-contracts'
import type { EntityManager } from 'typeorm'
import type { LedgerAccess } from '../ledgers/access.js'
import type { Access, Principal } from '../ledgers/types.js'
import type { SummaryRow } from '../repository.js'
import type { StatisticsService } from '../statistics/service.js'
import { randomUUID } from 'node:crypto'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { In, IsNull } from 'typeorm'
import { validateCategoryIcon } from '../categories/icons.js'
import { parseCategoryInput } from '../categories/validation.js'
import {
  DebtPositionEntity,
  DebtSettlementEntity,
  SettlementAllocationEntity,
} from '../domain-entities.js'
import { BillEntity, CategoryEntity } from '../entities.js'
import { ErrorCode } from '../error-codes.js'
import { invalid, notFound } from '../errors.js'
import { activeAccount, postAccount } from '../features/account-posting.js'
import { LedgerFeatures } from '../features/service.js'
import { isoTime } from '../ledgers/time.js'
import {
  date,
  debtInput,
  object,
  settlementInput,
} from '../ledgers/validation.js'
import { LedgerContactEntity } from '../persistence/records-entities.js'
import { aggregateSummary } from '../repository.js'
import { project } from '../statistics/projection.js'
import {
  monthBounds,
  parseBillInput,
  parseId,
  parseListFilters,
} from '../validation.js'
import { cents, money } from './money.js'
import { FinancialOperations } from './operations.js'

export interface BillRecordRow extends Pick<
  Bill,
  'id' | 'type' | 'amount' | 'category' | 'note'
> {
  created_by: string | null
  bill_date: string
  created_at: Date | string
  updated_at: Date | string
  account_id: string | null
}
interface DebtRecordRow extends Pick<
  Debt,
  | 'id' |
  'direction' |
  'counterparty' |
  'amount' |
  'settled' |
  'remaining' |
  'note'
> {
  ledger_id: string
  adjusted: string
  occurred_date: string
  due_date: string | null
  cash_movement: number | boolean
  account_id: string | null
  contact_id: string | null
  created_by: string | null
  created_at: Date | string
}

const billDTO = (row: BillRecordRow): Bill => ({
  id: row.id,
  createdBy: row.created_by,
  type: row.type,
  amount: row.amount,
  category: row.category,
  date: row.bill_date,
  note: row.note,
  createdAt: isoTime(row.created_at),
  updatedAt: isoTime(row.updated_at),
  accountId: row.account_id ?? null,
})
const debtDTO = (row: DebtRecordRow): Debt => ({
  id: row.id,
  ledgerId: row.ledger_id,
  direction: row.direction,
  counterparty: row.counterparty,
  amount: row.amount,
  settled: row.settled,
  adjusted: row.adjusted ?? '0.00',
  remaining: row.remaining,
  status: cents(row.remaining) > 0n ? 'open' : 'settled',
  date: row.occurred_date,
  dueDate: row.due_date,
  note: row.note,
  cashMovement: Boolean(Number(row.cash_movement)),
  accountId: row.account_id ?? null,
  contactId: row.contact_id ?? null,
  createdBy: row.created_by,
  createdAt: isoTime(row.created_at),
})
function ordinary(access: Access) {
  if (access.book.template === 'debt') {
    invalid('template', '往来账本仅记录应收、应付；收支请使用综合或日常账本')
  }
}
function debtEnabled(access: Access) {
  if (access.book.template === 'daily') {
    invalid('template', '此账本仅记录日常收支，请使用往来或综合账本')
  }
}
async function category(
  db: EntityManager,
  book: string,
  input: Pick<BillInput, 'category' | 'type'>,
  allowInactive = false,
) {
  const [row] = await db
    .createQueryBuilder()
    .select('1')
    .from('bill_categories', 'bill_categories')
    .where(
      'id=:p0 AND type=:p1 AND ledger_id=:p2 AND (active=TRUE OR :p3=TRUE)',
    )
    .setParameters({
      p0: input.category,
      p1: input.type,
      p2: book,
      p3: allowInactive,
    })
    .getRawMany()
  if (!row) {
    invalid('category', '分类不存在、类型不匹配或不属于当前账本')
  }
}
export async function billDelta(
  db: EntityManager,
  id: string,
  row: Bill,
  actor: string,
  sign = 1n,
) {
  const value = cents(row.amount) * sign
  await postAccount(
    db,
    id,
    row.accountId,
    row.id,
    row.date,
    row.type === 'income' ? value : -value,
    row.note,
    actor,
  )
  await project(db, id, {
    subjectId: row.id,
    kind: sign < 0n ? 'correction' : row.type,
    date: row.date,
    note: row.note,
    createdBy: actor,
    categoryId: row.category,
    billType: row.type,
    count: Number(sign),
    ...(row.type === 'income'
      ? { income: value, cashIn: value }
      : { expense: value, cashOut: value }),
  })
}
export class FinanceService {
  readonly operations: FinancialOperations
  readonly features: LedgerFeatures
  constructor(
    readonly access: LedgerAccess,
    readonly statistics: StatisticsService,
  ) {
    this.operations = new FinancialOperations(access)
    this.features = new LedgerFeatures(this)
  }

  async categories(principal: Principal, id: string): Promise<BillCategory[]> {
    await this.access.check(principal, id)
    return this.access.source
      .getRepository(CategoryEntity)
      .find({
        select: {
          id: true,
          label: true,
          type: true,
          icon: true,
          iconId: true,
          isDefault: true,
          active: true,
          pinned: true,
          sortOrder: true,
        },
        where: { ledgerId: id },
        order: {
          pinned: 'DESC',
          type: 'ASC',
          sortOrder: 'ASC',
          label: 'ASC',
          id: 'ASC',
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          label: row.label,
          type: row.type,
          icon: row.icon,
          iconId: row.iconId,
          isDefault: row.isDefault,
          active: row.active,
          pinned: row.pinned,
          sortOrder: row.sortOrder,
        })),
      )
      .then((rows) =>
        rows.map((row: BillCategory) => ({
          ...row,
          isDefault: Boolean(Number(row.isDefault)),
          active: Boolean(Number(row.active)),
          pinned: Boolean(Number(row.pinned)),
        })),
      )
  }

  async createCategory(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const input = parseCategoryInput(value)
    return this.operations.run(
      principal,
      id,
      key,
      'category.created',
      input,
      async (db) => {
        const result = {
          id: randomUUID(),
          ...input,
          icon: input.icon ?? 'other',
          isDefault: false,
          iconId: await validateCategoryIcon(
            db,
            id,
            principal.user.id,
            input.iconId,
          ),
        }
        await db.getRepository(CategoryEntity).insert({
          id: result.id,
          ledgerId: id,
          label: result.label,
          type: result.type,
          icon: result.icon,
          iconId: result.iconId,
          isDefault: false,
          sortOrder: 100,
        })
        return result
      },
    )
  }

  async bills(principal: Principal, id: string, query: unknown) {
    await this.access.check(principal, id)
    const input = object(query, [
      'month',
      'type',
      'q',
      'page',
      'pageSize',
      'start',
      'end',
      'categoryId',
      'memberId',
      'minAmount',
      'maxAmount',
    ])
    const { start, end, categoryId, memberId, minAmount, maxAmount, ...rest } =
      input
    const filters = parseListFilters(rest)
    const selection = this.access.source
      .createQueryBuilder()
      .from('bills', 'bills')
      .where('ledger_id=:ledgerId', { ledgerId: id })
      .andWhere('deleted_at IS NULL')
    if (start !== undefined || end !== undefined) {
      if (filters.month) {
        invalid('month', '不能与日期范围同时使用')
      }
      const from = date(start)
      const to = date(end)
      if (from > to) {
        invalid('end', '结束日期须在开始日期之后')
      }
      selection.andWhere('bill_date BETWEEN :from AND :to', { from, to })
    }
    if (filters.month) {
      const [from, to] = monthBounds(filters.month)
      selection.andWhere('bill_date BETWEEN :from AND :to', { from, to })
    }
    if (filters.type) {
      selection.andWhere('type=:type', { type: filters.type })
    }
    if (filters.q) {
      selection.andWhere('LOCATE(:query,note)>0', { query: filters.q })
    }
    if (categoryId !== undefined) {
      selection.andWhere('category=:categoryId', {
        categoryId: parseId(categoryId),
      })
    }
    if (memberId !== undefined) {
      selection.andWhere('created_by=:memberId', {
        memberId: parseId(memberId),
      })
    }
    for (const [value, operator] of [
      [minAmount, '>='],
      [maxAmount, '<='],
    ] as const) {
      if (value !== undefined) {
        if (
          typeof value !== 'string' ||
          !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)
        ) {
          invalid('amount', '筛选金额须为非负金额，最多两位小数')
        }
        const parameter = operator === '>=' ? 'minimum' : 'maximum'
        selection.andWhere(`amount${operator}:${parameter}`, {
          [parameter]: money(cents(value)),
        })
      }
    }
    if (
      minAmount !== undefined &&
      maxAmount !== undefined &&
      cents(String(minAmount)) > cents(String(maxAmount))
    ) {
      invalid('maxAmount', '最高金额不能低于最低金额')
    }
    const rows = await selection
      .clone()
      .select(
        'id,created_by,type,amount,category,bill_date,note,created_at,updated_at,account_id',
      )
      .orderBy('bill_date', 'DESC')
      .addOrderBy('created_at', 'DESC')
      .addOrderBy('id', 'DESC')
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize)
      .getRawMany<BillRecordRow>()
    const { total } = (await selection
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string | number }>())!
    return {
      data: rows.map(billDTO),
      meta: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: Number(total),
      },
    }
  }

  async getBill(principal: Principal, id: string, billId: string) {
    await this.access.check(principal, id)
    const row = await this.access.source
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
        where: { ledgerId: id, id: billId, deletedAt: IsNull() },
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
    if (!row) {
      notFound()
    }
    return billDTO(row)
  }

  async summary(
    principal: Principal,
    id: string,
    month?: string,
  ): Promise<BillSummary> {
    if (!month) {
      return this.access.source.transaction('REPEATABLE READ', async (db) => {
        await this.access.check(principal, id, 'read', false, db)
        const rows = await db
          .createQueryBuilder()
          .select('type')
          .addSelect('category_id', 'category')
          .addSelect('SUM(amount)', 'amount')
          .addSelect('SUM(record_count)', 'count')
          .from('ledger_daily_categories', 'categories')
          .where('ledger_id=:id', { id })
          .groupBy('type')
          .addGroupBy('category_id')
          .getRawMany<SummaryRow>()
        return aggregateSummary(rows)
      })
    }
    const data = await this.statistics.get(principal, id, {
      period: 'month',
      ...(month ? { value: month } : {}),
    })
    return {
      income: data.income,
      expense: data.expense,
      balance: data.balance,
      count: data.count,
      categories: data.categories
        .filter((row) => row.type === 'expense')
        .map(({ category, amount }) => ({ category, amount })),
    }
  }

  async createBill(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const input = parseBillInput(value) as BillInput
    return this.operations.run(
      principal,
      id,
      key,
      'bill.created',
      input,
      async (db, access) => {
        ordinary(access)
        await category(db, id, input)
        await activeAccount(db, id, input.accountId)
        const billId = randomUUID()
        await db.getRepository(BillEntity).insert({
          id: billId,
          ledgerId: id,
          type: input.type,
          amount: input.amount,
          category: input.category,
          date: input.date,
          note: input.note,
          createdBy: principal.user.id,
          accountId: input.accountId ?? null,
          createdAt: () => 'UTC_TIMESTAMP(3)',
          updatedAt: () => 'UTC_TIMESTAMP(3)',
        })
        const row = await db
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
            where: { id: billId },
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
        if (!row) {
          notFound()
        }
        const result = billDTO(row)
        await billDelta(db, id, result, principal.user.id)
        await db
          .createQueryBuilder()
          .insert()
          .into('ledger_category_recents')
          .values({
            id: () => ':p0',
            ledger_id: () => ':p1',
            user_id: () => ':p2',
            category_id: () => ':p3',
            last_used_at: () => 'UTC_TIMESTAMP(3)',
          })
          .updateEntity(false)
          .setParameters({
            p0: randomUUID(),
            p1: id,
            p2: principal.user.id,
            p3: result.category,
          })
          .orUpdate(['last_used_at'])
          .execute()
        return result
      },
    )
  }

  async updateBill(
    principal: Principal,
    id: string,
    billId: string,
    key: string | undefined,
    value: unknown,
  ) {
    const patch = parseBillInput(value, true)
    return this.operations.run(
      principal,
      id,
      key,
      'bill.updated',
      { billId, ...patch },
      async (db, access) => {
        ordinary(access)
        const row = await db
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
            where: { ledgerId: id, id: billId, deletedAt: IsNull() },
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
        if (!row) {
          notFound()
        }
        this.access.assertAuthor(access.role, row.created_by, principal.user.id)
        const old = billDTO(row)
        const next = { ...old, ...patch }
        await category(
          db,
          id,
          next,
          next.category === old.category && next.type === old.type,
        )
        if (next.accountId !== old.accountId) {
          await activeAccount(db, id, next.accountId)
        }
        // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
        const [linked] = await db.query(
          'SELECT (SELECT COUNT(*) FROM ledger_refunds WHERE bill_id=? AND reversed=FALSE)+(SELECT COUNT(*) FROM ledger_reimbursements WHERE bill_id=? AND status<>\'cancelled\') AS count',
          [billId, billId],
        )
        if (
          Number(linked.count) &&
          (['type', 'amount', 'category', 'date', 'accountId'] as const).some(
            (k) => next[k] !== old[k],
          )
        ) {
          throw ErrorCode.BILL_LINKED()
        }
        await db.getRepository(BillEntity).update(
          { id: billId },
          {
            type: next.type,
            amount: next.amount,
            category: next.category,
            date: next.date,
            note: next.note,
            accountId: next.accountId ?? null,
            updatedAt: () => 'UTC_TIMESTAMP(3)',
          },
        )
        if (
          (['type', 'amount', 'category', 'date', 'accountId'] as const).some(
            (k) => next[k] !== old[k],
          )
        ) {
          await billDelta(db, id, old, principal.user.id, -1n)
          await billDelta(db, id, next, principal.user.id)
        }
        const updated = await db
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
            where: { id: billId },
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
        if (!updated) {
          notFound()
        }
        return billDTO(updated)
      },
    )
  }

  async deleteBill(
    principal: Principal,
    id: string,
    billId: string,
    key: string | undefined,
  ) {
    return this.operations.run(
      principal,
      id,
      key,
      'bill.deleted',
      { billId },
      async (db, access) => {
        const row = await db
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
            where: { ledgerId: id, id: billId, deletedAt: IsNull() },
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
        if (!row) {
          notFound()
        }
        this.access.assertAuthor(access.role, row.created_by, principal.user.id)
        // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
        const [linked] = await db.query(
          'SELECT (SELECT COUNT(*) FROM ledger_refunds WHERE bill_id=? AND reversed=FALSE)+(SELECT COUNT(*) FROM ledger_reimbursements WHERE bill_id=? AND status<>\'cancelled\') AS count',
          [billId, billId],
        )
        if (Number(linked.count)) {
          throw ErrorCode.BILL_LINKED('账单存在退款或报销，不能直接删除')
        }
        await db
          .getRepository(BillEntity)
          .update({ id: billId }, { deletedAt: () => 'UTC_TIMESTAMP(3)' })
        await billDelta(db, id, billDTO(row), principal.user.id, -1n)
        return { id: billId, removed: true }
      },
    )
  }

  async debts(principal: Principal, id: string, query: unknown) {
    await this.access.check(principal, id)
    const input = object(query, [
      'direction',
      'status',
      'q',
      'counterparty',
      'page',
      'pageSize',
    ])
    const pagination = parseListFilters({
      ...(input.page ? { page: input.page } : {}),
      ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    })
    const selection = this.access.source
      .createQueryBuilder()
      .from('debt_positions', 'debts')
      .where('ledger_id=:ledgerId', { ledgerId: id })
    if (input.direction !== undefined) {
      if (!['receivable', 'payable'].includes(input.direction as string)) {
        invalid('direction', '方向无效')
      }
      selection.andWhere('direction=:direction', { direction: input.direction })
    }
    if (input.status !== undefined) {
      if (!['open', 'settled'].includes(input.status as string)) {
        invalid('status', '状态无效')
      }
      selection.andWhere(
        input.status === 'open' ? 'remaining>0' : 'remaining=0',
      )
    }
    if (input.q !== undefined) {
      if (typeof input.q !== 'string' || input.q.length > 80) {
        invalid('q', '搜索内容过长')
      }
      selection.andWhere(
        '(LOCATE(:query,counterparty)>0 OR LOCATE(:query,note)>0)',
        { query: input.q },
      )
    }
    if (input.counterparty !== undefined) {
      if (
        typeof input.counterparty !== 'string' ||
        !input.counterparty ||
        input.counterparty.length > 80
      ) {
        invalid('counterparty', '对象无效')
      }
      selection.andWhere('counterparty=:counterparty', {
        counterparty: input.counterparty,
      })
    }
    const { total } = (await selection
      .clone()
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string | number }>())!
    const rows = await selection
      .select(
        'id,ledger_id,direction,counterparty,amount,settled,adjusted,remaining,occurred_date,due_date,note,cash_movement,account_id,contact_id,created_by,created_at',
      )
      .orderBy('(remaining>0)', 'DESC')
      .addOrderBy('occurred_date', 'DESC')
      .addOrderBy('created_at', 'DESC')
      .addOrderBy('id', 'DESC')
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize)
      .getRawMany<DebtRecordRow>()
    return {
      data: rows.map(debtDTO),
      meta: { ...pagination, total: Number(total) },
    }
  }

  async createDebt(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const input = debtInput(value)
    return this.operations.run(
      principal,
      id,
      key,
      'debt.created',
      input,
      async (db, access) => {
        debtEnabled(access)
        await activeAccount(db, id, input.accountId)
        if (!input.cashMovement && input.accountId) {
          invalid('accountId', '补录往来不能指定资金账户')
        }
        if (input.contactId) {
          const contact = await db.getRepository(LedgerContactEntity).findOne({
            select: { name: true },
            where: { ledger_id: id, id: input.contactId, archived: false },
          })
          if (!contact) {
            invalid('contactId', '往来对象不存在')
          }
          input.counterparty = contact.name
        }
        const debtId = randomUUID()
        const value = cents(input.amount)
        await db.getRepository(DebtPositionEntity).insert({
          id: debtId,
          ledgerId: id,
          direction: input.direction,
          counterparty: input.counterparty,
          amount: input.amount,
          settled: '0.00',
          remaining: input.amount,
          date: input.date,
          dueDate: input.dueDate,
          note: input.note,
          cashMovement: input.cashMovement,
          createdBy: principal.user.id,
          accountId: input.accountId ?? null,
          contactId: input.contactId ?? null,
        })
        if (input.cashMovement) {
          await postAccount(
            db,
            id,
            input.accountId,
            debtId,
            input.date,
            input.direction === 'receivable' ? -value : value,
            input.note,
            principal.user.id,
          )
        }
        await project(db, id, {
          subjectId: debtId,
          kind: input.direction === 'receivable' ? 'lend' : 'borrow',
          date: input.date,
          note: input.note,
          createdBy: principal.user.id,
          ...(input.direction === 'receivable'
            ? {
                receivable: value,
                ...(input.cashMovement ? { cashOut: value } : {}),
              }
            : {
                payable: value,
                ...(input.cashMovement ? { cashIn: value } : {}),
              }),
        })
        const row = await db
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
            where: { id: debtId },
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
        if (!row) {
          notFound()
        }
        return debtDTO(row)
      },
    )
  }

  async settlements(principal: Principal, id: string): Promise<Settlement[]> {
    await this.access.check(principal, id)
    const rows = await this.access.source
      .getRepository(DebtSettlementEntity)
      .find({
        select: {
          accountId: true,
          id: true,
          ledgerId: true,
          direction: true,
          counterparty: true,
          amount: true,
          date: true,
          note: true,
          createdBy: true,
          reversed: true,
          createdAt: true,
        },
        where: { ledgerId: id },
        order: { date: 'DESC', createdAt: 'DESC', id: 'DESC' },
        take: 500,
      })
      .then((rows) =>
        rows.map((row) => ({
          account_id: row.accountId,
          id: row.id,
          ledger_id: row.ledgerId,
          direction: row.direction,
          counterparty: row.counterparty,
          amount: row.amount,
          settled_date: row.date,
          note: row.note,
          created_by: row.createdBy,
          reversed: row.reversed,
          created_at: sqlClock(row.createdAt),
        })),
      )
    const ids = rows.map((row: { id: string }) => row.id)
    const allocations = ids.length
      ? await this.access.source
          .getRepository(SettlementAllocationEntity)
          .find({
            select: { settlementId: true, debtId: true, amount: true },
            where: { ledgerId: id, settlementId: In(ids) },
          })
          .then((rows) =>
            rows.map((row) => ({
              settlement_id: row.settlementId,
              debtId: row.debtId,
              amount: row.amount,
            })),
          )
      : []
    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      counterparty: row.counterparty,
      amount: row.amount,
      date: row.settled_date,
      note: row.note,
      createdBy: row.created_by,
      reversed: Boolean(Number(row.reversed)),
      allocations: allocations
        .filter((entry) => entry.settlement_id === row.id)
        .map(({ debtId, amount }) => ({ debtId, amount })),
    }))
  }

  async settle(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ): Promise<Settlement> {
    const input = settlementInput(value)
    return this.operations.run(
      principal,
      id,
      key,
      'settlement.created',
      input,
      async (db, access) => {
        debtEnabled(access)
        await activeAccount(db, id, input.accountId)
        const ids = input.allocations.map((row) => row.debtId).sort()
        const debts = await db
          .getRepository(DebtPositionEntity)
          .find({
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
            where: { ledgerId: id, id: In(ids) },
            order: { id: 'ASC' },
            lock: { mode: 'pessimistic_write' },
          })
          .then((rows) =>
            rows.map((row) => ({
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
            })),
          )
        if (debts.length !== ids.length) {
          invalid('allocations', '部分往来不存在或不属于此账本')
        }
        const first = debts[0]
        if (!first) {
          invalid('allocations', '请选择需要收还款的往来')
        }
        let total = 0n
        for (const allocation of input.allocations) {
          const debt = debts.find((row) => row.id === allocation.debtId)
          if (!debt) {
            invalid('allocations', '往来不存在或不属于此账本')
          }
          if (
            debt.direction !== first.direction ||
            debt.counterparty !== first.counterparty
          ) {
            invalid('allocations', '一次收还款只能关联同一对象、同一方向的往来')
          }
          if (input.date < debt.occurred_date) {
            invalid('date', '收还款日期不能早于关联往来的发生日期')
          }
          const value = cents(allocation.amount)
          if (value > cents(debt.remaining)) {
            throw ErrorCode.OVER_SETTLEMENT()
          }
          total += value
        }
        const result: Settlement = {
          id: randomUUID(),
          direction: first.direction,
          counterparty: first.counterparty,
          amount: money(total),
          date: input.date,
          note: input.note,
          createdBy: principal.user.id,
          reversed: false,
          allocations: input.allocations,
        }
        await db.getRepository(DebtSettlementEntity).insert({
          id: result.id,
          ledgerId: id,
          direction: result.direction,
          counterparty: result.counterparty,
          amount: result.amount,
          date: result.date,
          note: result.note,
          createdBy: principal.user.id,
          accountId: input.accountId ?? null,
        })
        for (const allocation of input.allocations) {
          await db.getRepository(SettlementAllocationEntity).insert({
            ledgerId: id,
            settlementId: result.id,
            debtId: allocation.debtId,
            amount: allocation.amount,
          })
          await db
            .createQueryBuilder()
            .update('debt_positions')
            .set({
              settled: () => 'settled+:p0',
              remaining: () => 'remaining-:p1',
            })
            .updateEntity(false)
            .where('id=:p2')
            .setParameters({
              p0: allocation.amount,
              p1: allocation.amount,
              p2: allocation.debtId,
            })
            .execute()
        }
        await postAccount(
          db,
          id,
          input.accountId,
          result.id,
          result.date,
          result.direction === 'receivable' ? total : -total,
          result.note,
          principal.user.id,
        )
        await project(db, id, {
          subjectId: result.id,
          kind: result.direction === 'receivable' ? 'collect' : 'repay',
          date: result.date,
          note: result.note,
          createdBy: principal.user.id,
          ...(result.direction === 'receivable'
            ? { receivable: -total, cashIn: total }
            : { payable: -total, cashOut: total }),
        })
        return result
      },
    )
  }

  async reverseSettlement(
    principal: Principal,
    id: string,
    settlementId: string,
    key: string | undefined,
  ) {
    return this.operations.run(
      principal,
      id,
      key,
      'settlement.reversed',
      { settlementId },
      async (db, access) => {
        const row = await db
          .getRepository(DebtSettlementEntity)
          .findOne({
            select: {
              accountId: true,
              id: true,
              ledgerId: true,
              direction: true,
              counterparty: true,
              amount: true,
              date: true,
              note: true,
              createdBy: true,
              reversed: true,
              createdAt: true,
            },
            where: { id: settlementId, ledgerId: id },
          })
          .then((row) =>
            row
              ? {
                  account_id: row.accountId,
                  id: row.id,
                  ledger_id: row.ledgerId,
                  direction: row.direction,
                  counterparty: row.counterparty,
                  amount: row.amount,
                  settled_date: row.date,
                  note: row.note,
                  created_by: row.createdBy,
                  reversed: row.reversed,
                  created_at: sqlClock(row.createdAt),
                }
              : null,
          )
        if (!row) {
          notFound()
        }
        this.access.assertAuthor(access.role, row.created_by, principal.user.id)
        if (Number(row.reversed)) {
          return { id: settlementId, reversed: true }
        }
        const allocations = await db
          .getRepository(SettlementAllocationEntity)
          .find({
            select: {
              ledgerId: true,
              settlementId: true,
              debtId: true,
              amount: true,
            },
            where: { settlementId },
          })
          .then((rows) =>
            rows.map((row) => ({
              ledger_id: row.ledgerId,
              settlement_id: row.settlementId,
              debt_id: row.debtId,
              amount: row.amount,
            })),
          )
        for (const allocation of allocations) {
          await db
            .createQueryBuilder()
            .update('debt_positions')
            .set({
              settled: () => 'settled-:p0',
              remaining: () => 'remaining+:p1',
            })
            .updateEntity(false)
            .where('id=:p2')
            .setParameters({
              p0: allocation.amount,
              p1: allocation.amount,
              p2: allocation.debt_id,
            })
            .execute()
        }
        await db
          .getRepository(DebtSettlementEntity)
          .update({ id: settlementId }, { reversed: true })
        const amount = cents(row.amount)
        await postAccount(
          db,
          id,
          row.account_id,
          settlementId,
          row.settled_date,
          row.direction === 'receivable' ? -amount : amount,
          '撤销收还款',
          principal.user.id,
        )
        await project(db, id, {
          subjectId: settlementId,
          kind: 'correction',
          date: row.settled_date,
          note: `撤销收还款：${row.note}`.slice(0, 200),
          createdBy: principal.user.id,
          ...(row.direction === 'receivable'
            ? { receivable: amount, cashIn: -amount }
            : { payable: amount, cashOut: -amount }),
        })
        return { id: settlementId, reversed: true }
      },
    )
  }

  async events(principal: Principal, id: string, query: unknown) {
    await this.access.check(principal, id)
    const input = object(query, ['start', 'end', 'page', 'pageSize'])
    const filters = parseListFilters({
      ...(input.page ? { page: input.page } : {}),
      ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    })
    const start = date(input.start)
    const end = date(input.end)
    if (start > end) {
      invalid('end', '日期范围无效')
    }
    const selection = this.access.source
      .createQueryBuilder()
      .from('ledger_events', 'events')
      .where('ledger_id=:id AND event_date BETWEEN :start AND :end', {
        id,
        start,
        end,
      })
    const { total } = (await selection
      .clone()
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string | number }>())!
    const data = await selection
      .select(
        'id,subject_id AS subjectId,kind,event_date AS date,income,expense,cash_in AS inflow,cash_out AS outflow,receivable_delta AS receivableChange,payable_delta AS payableChange,note,created_by AS createdBy',
      )
      .orderBy('event_date', 'DESC')
      .addOrderBy('created_at', 'DESC')
      .addOrderBy('id', 'DESC')
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize)
      .getRawMany()
    return { data, meta: { ...filters, total: Number(total) } }
  }
}
