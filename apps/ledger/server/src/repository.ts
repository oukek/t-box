import type { Bill, BillInput, BillSummary } from '@t-box/ledger-contracts'
import type { DataSource, SelectQueryBuilder } from 'typeorm'
import type { StoredBill } from './entities.js'
import type { ListFilters } from './validation.js'
import { randomUUID } from 'node:crypto'
import { BillEntity } from './entities.js'
import { monthBounds } from './validation.js'

export interface BillRepository {
  list(filters: ListFilters): Promise<{ data: Bill[], total: number }>
  summary(month?: string): Promise<BillSummary>
  get(id: string): Promise<Bill | undefined>
  create(input: BillInput): Promise<Bill>
  update(id: string, patch: Partial<BillInput>): Promise<Bill | undefined>
  delete(id: string): Promise<boolean>
}
function filtered(
  query: SelectQueryBuilder<StoredBill>,
  filters: Pick<ListFilters, 'month' | 'type' | 'q'>,
) {
  if (filters.month) {
    const [start, end] = monthBounds(filters.month)
    query.andWhere('bill.date BETWEEN :start AND :end', { start, end })
  }
  if (filters.type) {
    query.andWhere('bill.type=:type', { type: filters.type })
  }
  if (filters.q) {
    query.andWhere('LOCATE(:q,bill.note)>0', { q: filters.q })
  }
  return query
}
const timestamp = (value: string | Date) =>
  value instanceof Date
    ? value.toISOString()
    : new Date(`${value.replace(' ', 'T')}Z`).toISOString()
const dto = (bill: StoredBill): Bill => ({
  ...bill,
  createdAt: timestamp(bill.createdAt),
  updatedAt: timestamp(bill.updatedAt),
})
function decimalToCents(value: string): bigint {
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  const result = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -result : result
}
export function centsToDecimal(value: bigint): string {
  const abs = value < 0n ? -value : value
  return `${value < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n)
    .toString()
    .padStart(2, '0')}`
}
export interface SummaryRow {
  type: Bill['type']
  category: string
  amount: string
  count: string | number
}
export function aggregateSummary(rows: SummaryRow[]): BillSummary {
  let income = 0n
  let expense = 0n
  let count = 0
  const categories: BillSummary['categories'] = []
  for (const row of rows) {
    const cents = decimalToCents(row.amount)
    count += Number(row.count)
    if (row.type === 'income') {
      income += cents
    } else {
      expense += cents
      categories.push({
        category: row.category,
        amount: centsToDecimal(cents),
      })
    }
  }
  categories.sort((a, b) => {
    const delta = decimalToCents(b.amount) - decimalToCents(a.amount)
    return delta > 0n
      ? 1
      : delta < 0n
        ? -1
        : a.category.localeCompare(b.category)
  })
  return {
    income: centsToDecimal(income),
    expense: centsToDecimal(expense),
    balance: centsToDecimal(income - expense),
    count,
    categories,
  }
}
export function createBillRepository(source: DataSource): BillRepository {
  const repository = source.getRepository(BillEntity)
  const get = async (id: string) => {
    const row = await repository.findOneBy({ id })
    return row ? dto(row) : undefined
  }
  return {
    get,
    async list(filters) {
      const [rows, total] = await filtered(
        repository.createQueryBuilder('bill'),
        filters,
      )
        .orderBy('bill.date', 'DESC')
        .addOrderBy('bill.createdAt', 'DESC')
        .addOrderBy('bill.id', 'DESC')
        .skip((filters.page - 1) * filters.pageSize)
        .take(filters.pageSize)
        .getManyAndCount()
      return { data: rows.map(dto), total }
    },
    async summary(month) {
      const rows = await filtered(repository.createQueryBuilder('bill'), {
        month,
      })
        .select('bill.type', 'type')
        .addSelect('bill.category', 'category')
        .addSelect('SUM(bill.amount)', 'amount')
        .addSelect('COUNT(*)', 'count')
        .groupBy('bill.type')
        .addGroupBy('bill.category')
        .getRawMany<SummaryRow>()
      return aggregateSummary(rows)
    },
    async create(input) {
      const now = new Date().toISOString()
      const bill = {
        id: randomUUID(),
        ...input,
        createdAt: now,
        updatedAt: now,
      }
      // Explicit timestamps avoid database defaults changing monetary or calendar inputs.
      await repository.insert({
        ...bill,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      return bill
    },
    async update(id, patch) {
      const result = await repository.update(
        { id },
        { ...patch, updatedAt: new Date() },
      )
      return result.affected ? get(id) : undefined
    },
    async delete(id) {
      return Boolean((await repository.delete({ id })).affected)
    },
  }
}
