import type {
  LedgerStatisticPoint,
  LedgerStatistics,
  StatisticPeriod,
} from '@t-box/ledger-contracts'
import type { LedgerAccess } from '../ledgers/access.js'
import type { Principal } from '../ledgers/types.js'
import { invalid } from '@t-box/server-foundation/errors'
import { LedgerEntity } from '../domain-entities.js'
import { cents, money } from '../finance/money.js'
import { audit } from '../ledgers/audit.js'
import { date, object, today } from '../ledgers/validation.js'
import { monthBounds } from '../validation.js'
import { rebuild } from './projection.js'

export function statisticsPeriod(value: unknown): {
  period: StatisticPeriod
  value: string
  start: string
  end: string
} {
  const input = object(value, ['period', 'value'])
  const period = (input.period ?? 'month') as StatisticPeriod
  if (!['day', 'month', 'quarter', 'year'].includes(period)) {
    invalid('period', '请选择日、月、季度或年')
  }
  const current = today()
  const fallback =
    period === 'day'
      ? current
      : period === 'month'
        ? current.slice(0, 7)
        : period === 'year'
          ? current.slice(0, 4)
          : `${current.slice(0, 4)}-Q${Math.ceil(Number(current.slice(5, 7)) / 3)}`
  const selected = input.value ?? fallback
  if (typeof selected !== 'string') {
    invalid('value', '统计期间格式无效')
  }
  if (period === 'day') {
    const selectedDate = date(selected)
    return { period, value: selected, start: selectedDate, end: selectedDate }
  }
  if (period === 'month') {
    if (!/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(selected)) {
      invalid('value', '月份格式为 YYYY-MM')
    }
    const [start, end] = monthBounds(selected)
    return { period, value: selected, start, end }
  }
  if (period === 'year') {
    if (!/^[1-9]\d{3}$/.test(selected)) {
      invalid('value', '年份格式为 YYYY')
    }
    return {
      period,
      value: selected,
      start: `${selected}-01-01`,
      end: `${selected}-12-31`,
    }
  }
  const match = /^([1-9]\d{3})-Q([1-4])$/.exec(selected)
  if (!match) {
    invalid('value', '季度格式为 YYYY-Q1 至 YYYY-Q4')
  }
  const quarter = Number(match[2])
  return {
    period,
    value: selected,
    start: `${match[1]}-${String(quarter * 3 - 2).padStart(2, '0')}-01`,
    end: monthBounds(`${match[1]}-${String(quarter * 3).padStart(2, '0')}`)[1],
  }
}
const numeric = (value: string | null | undefined) => cents(value ?? '0.00')
export class StatisticsService {
  constructor(private readonly access: LedgerAccess) {}
  async get(
    principal: Principal,
    ledgerId: string,
    query: unknown,
  ): Promise<LedgerStatistics> {
    const period = statisticsPeriod(query)
    return this.access.source.transaction('REPEATABLE READ', async (db) => {
      const { book } = await this.access.check(
        principal,
        ledgerId,
        'read',
        false,
        db,
      )
      const rows = await db
        .createQueryBuilder()
        .select(
          'stat_date AS date,income,expense,cash_in AS cashIn,cash_out AS cashOut,receivable_delta AS receivableChange,payable_delta AS payableChange,record_count AS count',
        )
        .from('ledger_daily_stats', 'ledger_daily_stats')
        .where('ledger_id=:p0 AND stat_date BETWEEN :p1 AND :p2')
        .orderBy('stat_date', 'ASC')
        .setParameters({ p0: ledgerId, p1: period.start, p2: period.end })
        .getRawMany()
      const totals = {
        income: 0n,
        expense: 0n,
        cashIn: 0n,
        cashOut: 0n,
        count: 0,
      }
      for (const row of rows) {
        totals.income += numeric(row.income)
        totals.expense += numeric(row.expense)
        totals.cashIn += numeric(row.cashIn)
        totals.cashOut += numeric(row.cashOut)
        totals.count += Number(row.count)
      }
      const [balances] = await db
        .createQueryBuilder()
        .select(
          'SUM(IF(stat_date<:p0,receivable_delta,0)) AS openingReceivable,SUM(IF(stat_date<:p1,payable_delta,0)) AS openingPayable,\n        SUM(IF(stat_date<=:p2,receivable_delta,0)) AS closingReceivable,SUM(IF(stat_date<=:p3,payable_delta,0)) AS closingPayable,\n        SUM(IF(stat_date<=:p4,receivable_delta,0)) AS currentReceivable,SUM(IF(stat_date<=:p5,payable_delta,0)) AS currentPayable',
        )
        .from('ledger_daily_stats', 'ledger_daily_stats')
        .where('ledger_id=:p6')
        .setParameters({
          p0: period.start,
          p1: period.start,
          p2: period.end,
          p3: period.end,
          p4: today(),
          p5: today(),
          p6: ledgerId,
        })
        .getRawMany()
      const categories = await db
        .createQueryBuilder()
        .select('category_id', 'category')
        .addSelect('type')
        .addSelect('SUM(amount)', 'amount')
        .addSelect('SUM(record_count)', 'count')
        .from('ledger_daily_categories', 'categories')
        .where('ledger_id=:ledgerId AND stat_date BETWEEN :start AND :end', {
          ledgerId,
          start: period.start,
          end: period.end,
        })
        .groupBy('category_id')
        .addGroupBy('type')
        .having('SUM(amount)<>0')
        .orderBy('SUM(amount)', 'DESC')
        .getRawMany()
      const byDate = new Map<string, LedgerStatisticPoint>(
        rows.map((row: LedgerStatisticPoint) => [
          row.date,
          { ...row, count: Number(row.count) },
        ]),
      )
      const series: LedgerStatisticPoint[] = []
      let cursor = period.start
      while (cursor <= period.end) {
        series.push(
          byDate.get(cursor) ?? {
            date: cursor,
            income: '0.00',
            expense: '0.00',
            cashIn: '0.00',
            cashOut: '0.00',
            receivableChange: '0.00',
            payableChange: '0.00',
            count: 0,
          },
        )
        if (cursor === period.end) {
          break
        }
        const next = new Date(`${cursor}T12:00:00Z`)
        next.setUTCDate(next.getUTCDate() + 1)
        cursor = next.toISOString().slice(0, 10)
      }
      // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
      const [deductions] = await db.query(
        'SELECT (SELECT COALESCE(SUM(amount),0) FROM ledger_refunds WHERE ledger_id=? AND reversed=FALSE AND refund_date BETWEEN ? AND ?) AS refunded,(SELECT COALESCE(SUM(amount),0) FROM ledger_reimbursement_receipts WHERE ledger_id=? AND reversed=FALSE AND receipt_date BETWEEN ? AND ?) AS reimbursed',
        [
          ledgerId,
          period.start,
          period.end,
          ledgerId,
          period.start,
          period.end,
        ],
      )
      return {
        grossExpense: money(
          totals.expense +
          numeric(deductions.refunded) +
          numeric(deductions.reimbursed),
        ),
        refunded: money(numeric(deductions.refunded)),
        reimbursed: money(numeric(deductions.reimbursed)),
        ...period,
        revision: Number(book.revision),
        income: money(totals.income),
        expense: money(totals.expense),
        balance: money(totals.income - totals.expense),
        cashIn: money(totals.cashIn),
        cashOut: money(totals.cashOut),
        cashNet: money(totals.cashIn - totals.cashOut),
        count: totals.count,
        openingReceivable: money(numeric(balances.openingReceivable)),
        openingPayable: money(numeric(balances.openingPayable)),
        closingReceivable: money(numeric(balances.closingReceivable)),
        closingPayable: money(numeric(balances.closingPayable)),
        currentReceivable: money(numeric(balances.currentReceivable)),
        currentPayable: money(numeric(balances.currentPayable)),
        categories: categories.map(
          (row: {
            category: string
            type: 'income' | 'expense'
            amount: string
            count: string
          }) => ({ ...row, count: Number(row.count) }),
        ),
        series,
      }
    })
  }

  async rebuild(principal: Principal, ledgerId: string) {
    await this.access.transaction(principal, ledgerId, 'manage', async (db) => {
      await rebuild(db, ledgerId)
      await db
        .getRepository(LedgerEntity)
        .update({ id: ledgerId }, { revision: () => 'revision+1' })
      await audit(db, ledgerId, principal.user.id, 'statistics.rebuilt', null)
    })
    return { rebuilt: true }
  }
}
