import type { BillInput, LedgerImportRow } from '@t-box/ledger-contracts'
import type { Principal } from '../ledgers/types.js'
import type { LedgerFeatures } from './service.js'
import { randomUUID } from 'node:crypto'
/** RFC 4180 fields, including quoted newlines and escaped quotes. */
import { parseCsv as readCsv } from '@t-box/ledger-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { In, Raw } from 'typeorm'
import { SettlementAllocationEntity } from '../domain-entities.js'
import { ErrorCode } from '../error-codes.js'
import { date, object } from '../ledgers/validation.js'
import { LedgerImportDraftEntity } from '../persistence/records-entities.js'
import { parseBillInput } from '../validation.js'
import { FeatureService, json, notFound } from './base.js'

export function parseCsv(content: string) {
  try {
    return readCsv(content)
  } catch (e) {
    invalid('csv', e instanceof Error ? e.message : 'CSV 格式无效')
  }
}
export function csvText(rows: unknown[][]) {
  const safe = (v: unknown) => {
    let s = String(v ?? '')
    if (/^[=+@-]/.test(s)) {
      s = '\'' + s
    }
    return '"' + s.replaceAll('"', '""') + '"'
  }
  return '\uFEFF' + rows.map((r) => r.map(safe).join(',')).join('\r\n')
}
interface ExportBillRow {
  id: string
  type: 'income' | 'expense'
  amount: string
  label: string
  bill_date: string
  note: string
  account_id: string | null
}
interface ExportRecordBase {
  id: string
  direction: 'receivable' | 'payable'
  counterparty: string
  amount: string
  note: string
}
interface ExportDebtRow extends ExportRecordBase {
  occurred_date: string
  settled: string
  adjusted: string
  remaining: string
  due_date: string | null
}
interface ExportSettlementRow extends ExportRecordBase {
  settled_date: string
  reversed: number | boolean
}

export class ImportExportService extends FeatureService {
  constructor(
    finance: FeatureService['finance'],
    readonly features: LedgerFeatures,
  ) {
    super(finance)
  }

  async preview(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    await this.read(actor, book)
    const v = object(value, ['csv', 'mapping', 'rows'])
    let raw: unknown[]
    if (Array.isArray(v.rows)) {
      raw = v.rows
    } else {
      if (typeof v.csv !== 'string') {
        invalid('csv', '请上传 UTF-8 CSV')
      }
      const table = parseCsv(v.csv.replace(/^\uFEFF/, ''))
      const headers = table.shift() ?? []
      const mapping =
        v.mapping === undefined
          ? {
              type: '类型',
              amount: '金额',
              category: '分类',
              date: '日期',
              note: '备注',
              accountId: '账户ID',
            }
          : object(v.mapping, [
              'type',
              'amount',
              'category',
              'date',
              'note',
              'accountId',
            ])
      raw = table.map((r) =>
        Object.fromEntries(
          Object.entries(mapping).map(([k, name]) => [
            k,
            r[headers.indexOf(String(name))] ?? '',
          ]),
        ),
      )
    }
    if (!raw.length || raw.length > 100) {
      invalid('rows', '每次请导入 1–100 条账单')
    }
    const categories = await this.finance.categories(actor, book)
    const rows: LedgerImportRow[] = []
    for (let i = 0; i < raw.length; i++) {
      try {
        const v = object(raw[i], [
          'type',
          'amount',
          'category',
          'date',
          'note',
          'accountId',
        ])
        const type =
          v.type === '收入' ? 'income' : v.type === '支出' ? 'expense' : v.type
        const cat = categories.find(
          (c) =>
            c.active !== false &&
            c.type === type &&
            (c.id === v.category || c.label === v.category),
        )
        if (!cat) {
          invalid('category', '分类不存在，请先创建或重新映射')
        }
        const bill = parseBillInput({
          ...v,
          type,
          category: cat.id,
          note: v.note ?? '',
          ...(v.accountId ? {} : { accountId: null }),
        }) as BillInput
        const [duplicate] = await this.db
          .createQueryBuilder()
          .select('id')
          .from('bills', 'bills')
          .where(
            'ledger_id=:p0 AND deleted_at IS NULL AND type=:p1 AND amount=:p2 AND category=:p3 AND bill_date=:p4 AND note=:p5 AND account_id <=> :p6',
          )
          .limit(1)
          .setParameters({
            p0: book,
            p1: bill.type,
            p2: bill.amount,
            p3: bill.category,
            p4: bill.date,
            p5: bill.note,
            p6: bill.accountId ?? null,
          })
          .getRawMany()
        rows.push({
          index: i + 1,
          input: bill,
          error: null,
          duplicate: !!duplicate,
        })
      } catch (e) {
        rows.push({
          index: i + 1,
          input: null,
          raw: Object.fromEntries(
            Object.entries(
              raw[i] && typeof raw[i] === 'object' && !Array.isArray(raw[i])
                ? (raw[i] as Record<string, unknown>)
                : {},
            )
              .filter(([k]) =>
                [
                  'type',
                  'amount',
                  'category',
                  'date',
                  'note',
                  'accountId',
                ].includes(k),
              )
              .map(([k, v]) => [k, typeof v === 'string' ? v : '']),
          ),
          error: e instanceof Error ? e.message : '字段无效',
          duplicate: false,
        })
      }
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'import.previewed',
      { rows },
      async (db) => {
        const id = randomUUID()
        await db.getRepository(LedgerImportDraftEntity).insert({
          id,
          ledger_id: book,
          user_id: actor.user.id,
          rows_json: rows,
          expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY)',
          created_by: actor.user.id,
        })
        return { id, rows, status: 'draft', result: null }
      },
    )
  }

  async commit(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['rows', 'allowDuplicates'])
    if (
      typeof v.allowDuplicates !== 'boolean' ||
      !Array.isArray(v.rows) ||
      !v.rows.length ||
      v.rows.length > 100
    ) {
      invalid('rows', '请选择要导入的行并确认重复记录策略')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'import.committed',
      { id, ...v },
      async (db) => {
        const draft = await db.getRepository(LedgerImportDraftEntity).findOne({
          select: {
            id: true,
            ledger_id: true,
            user_id: true,
            rows_json: true,
            status: true,
            result_json: true,
            expires_at: true,
            created_by: true,
            created_at: true,
          },
          where: {
            id,
            ledger_id: book,
            user_id: actor.user.id,
            expires_at: Raw((column) => `${column} > UTC_TIMESTAMP(3)`),
          },
        })
        if (!draft) {
          notFound()
        }
        if (draft.status === 'committed') {
          return json(draft.result_json)
        }
        const original = json<LedgerImportRow[]>(draft.rows_json)
        const seen = new Set<number>()
        const entries: { kind: 'bill', input: BillInput }[] = []
        for (const raw of v.rows as unknown[]) {
          const r = object(raw, ['index', 'input'])
          if (
            typeof r.index !== 'number' ||
            !original.some((row) => row.index === r.index) ||
            seen.has(r.index)
          ) {
            invalid('rows', '导入行号无效或重复')
          }
          seen.add(r.index)
          const input = parseBillInput(r.input) as BillInput
          if (!v.allowDuplicates) {
            const [duplicate] = await db
              .createQueryBuilder()
              .select('id')
              .from('bills', 'bills')
              .where(
                'ledger_id=:p0 AND deleted_at IS NULL AND type=:p1 AND amount=:p2 AND category=:p3 AND bill_date=:p4 AND note=:p5 AND account_id <=> :p6',
              )
              .limit(1)
              .setParameters({
                p0: book,
                p1: input.type,
                p2: input.amount,
                p3: input.category,
                p4: input.date,
                p5: input.note,
                p6: input.accountId ?? null,
              })
              .getRawMany()
            if (duplicate) {
              throw ErrorCode.IMPORT_DUPLICATE(`第 ${r.index} 行已存在相同记录`)
            }
            const fingerprint = JSON.stringify(input)
            if (entries.some((e) => JSON.stringify(e.input) === fingerprint)) {
              invalid('rows', `第 ${r.index} 行在文件中重复`)
            }
          }
          entries.push({ kind: 'bill', input })
        }
        const result = await this.features.batch.create(
          actor,
          book,
          `import:${id}`,
          { items: entries },
        )
        await db
          .getRepository(LedgerImportDraftEntity)
          .update({ id }, { status: 'committed', result_json: result })
        return result
      },
    )
  }

  async export(actor: Principal, book: string, query: unknown) {
    await this.read(actor, book)
    const v = object(query, [
      'start',
      'end',
      'kind',
      'type',
      'categoryId',
      'memberId',
    ])
    const from = date(v.start)
    const to = date(v.end)
    if (from > to) {
      invalid('end', '日期范围无效')
    }
    if (
      ![
        'bills',
        'debts',
        'settlements',
        'refunds',
        'reimbursements',
        'events',
        'accountEntries',
      ].includes(v.kind as string)
    ) {
      invalid('kind', '请选择导出类型')
    }
    if (
      ['refunds', 'reimbursements', 'events', 'accountEntries'].includes(
        String(v.kind),
      )
    ) {
      const specs: Record<
        string,
        {
          table: string
          date: string
          title: string
          columns: string[]
          labels: string[]
        }
      > = {
        refunds: {
          table: 'ledger_refunds',
          date: 'refund_date',
          title: '退款',
          columns: [
            'id',
            'bill_id',
            'amount',
            'refund_date',
            'account_id',
            'note',
            'reversed',
            'created_by',
          ],
          labels: [
            '记录ID',
            '原支出ID',
            '金额',
            '日期',
            '账户ID',
            '备注',
            '已撤销',
            '记录人ID',
          ],
        },
        reimbursements: {
          table: 'ledger_reimbursement_receipts',
          date: 'receipt_date',
          title: '报销到账',
          columns: [
            'id',
            'reimbursement_id',
            'amount',
            'receipt_date',
            'account_id',
            'note',
            'reversed',
            'created_by',
          ],
          labels: [
            '记录ID',
            '申请ID',
            '金额',
            '日期',
            '账户ID',
            '备注',
            '已撤销',
            '记录人ID',
          ],
        },
        events: {
          table: 'ledger_events',
          date: 'event_date',
          title: '财务事件',
          columns: [
            'id',
            'subject_id',
            'kind',
            'event_date',
            'income',
            'expense',
            'cash_in',
            'cash_out',
            'receivable_delta',
            'payable_delta',
            'record_count',
            'note',
            'created_by',
          ],
          labels: [
            '事件ID',
            '原记录ID',
            '类型',
            '日期',
            '收入变动',
            '净支出变动',
            '现金流入变动',
            '现金流出变动',
            '应收变动',
            '应付变动',
            '笔数变动',
            '备注',
            '记录人ID',
          ],
        },
        accountEntries: {
          table: 'ledger_account_entries',
          date: 'entry_date',
          title: '账户流水',
          columns: [
            'id',
            'account_id',
            'subject_id',
            'entry_date',
            'amount',
            'note',
            'created_by',
          ],
          labels: [
            '记录ID',
            '账户ID',
            '原记录ID',
            '日期',
            '余额变动',
            '备注',
            '记录人ID',
          ],
        },
      }
      const spec = specs[String(v.kind)]!
      const rows = await this.db
        .createQueryBuilder()
        .select(spec.columns.join(','))
        .from(`${spec.table}`, `${spec.table}`)
        .where(`ledger_id=:p0 AND ${spec.date} BETWEEN :p1 AND :p2`)
        .orderBy(`${spec.date}`, 'ASC')
        .addOrderBy('created_at', 'ASC')
        .limit(10001)
        .setParameters({ p0: book, p1: from, p2: to })
        .getRawMany<Record<string, string | number | null>>()
      if (rows.length > 10000) {
        invalid('export', '请缩小日期范围（每次最多 10000 条）')
      }
      return {
        filename: `${spec.title}-${from}-${to}.csv`,
        csv: csvText([
          spec.labels,
          ...rows.map((r) => spec.columns.map((c) => r[c])),
        ]),
      }
    }
    if (v.kind === 'bills') {
      const selection = this.db
        .createQueryBuilder()
        .select('b.id,b.type,b.amount,c.label,b.bill_date,b.note,b.account_id')
        .from('bills', 'b')
        .innerJoin('bill_categories', 'c', 'c.id=b.category')
        .where('b.ledger_id=:book AND b.bill_date BETWEEN :from AND :to', {
          book,
          from,
          to,
        })
        .andWhere('b.deleted_at IS NULL')
      for (const [k, col] of [
        ['type', 'b.type'],
        ['categoryId', 'b.category'],
        ['memberId', 'b.created_by'],
      ]) {
        if (v[k!]) {
          selection.andWhere(`${col}=:${k}`, { [k!]: v[k!] })
        }
      }
      const rows = await selection
        .orderBy('b.bill_date', 'ASC')
        .addOrderBy('b.created_at', 'ASC')
        .limit(10001)
        .getRawMany<ExportBillRow>()
      if (rows.length > 10000) {
        invalid('export', '请缩小日期范围（每次最多 10000 条）')
      }
      return {
        filename: `收支-${from}-${to}.csv`,
        csv: csvText([
          ['类型', '金额', '分类', '日期', '备注', '账户ID', '记录ID'],
          ...rows.map((r) => [
            r.type === 'income' ? '收入' : '支出',
            r.amount,
            r.label,
            r.bill_date,
            r.note,
            r.account_id,
            r.id,
          ]),
        ]),
      }
    }
    const debt = v.kind === 'debts'
    const rows = await this.db
      .createQueryBuilder()
      .select(
        debt
          ? 'id,direction,counterparty,amount,occurred_date,note,settled,adjusted,remaining,due_date'
          : 'id,direction,counterparty,amount,settled_date,note,reversed',
      )
      .from(
        `${debt ? 'debt_positions' : 'debt_settlements'}`,
        `${debt ? 'debt_positions' : 'debt_settlements'}`,
      )
      .where(
        `ledger_id=:p0 AND ${debt ? 'occurred_date' : 'settled_date'} BETWEEN :p1 AND :p2`,
      )
      .orderBy('created_at', 'ASC')
      .limit(10001)
      .setParameters({ p0: book, p1: from, p2: to })
      .getRawMany<ExportDebtRow | ExportSettlementRow>()
    if (rows.length > 10000) {
      invalid('export', '请缩小日期范围')
    }
    const allocations = new Map<string, string>()
    if (!debt && rows.length) {
      const ids = rows.map((r) => r.id)
      const parts = await this.db
        .getRepository(SettlementAllocationEntity)
        .find({
          select: { settlementId: true, debtId: true, amount: true },
          where: { ledgerId: book, settlementId: In(ids) },
        })
        .then((rows) =>
          rows.map((row) => ({
            settlement_id: row.settlementId,
            debt_id: row.debtId,
            amount: row.amount,
          })),
        )
      for (const r of rows) {
        allocations.set(
          r.id,
          JSON.stringify(
            parts
              .filter((p) => p.settlement_id === r.id)
              .map((p) => ({ debtId: p.debt_id, amount: p.amount })),
          ),
        )
      }
    }
    return {
      filename: `${debt ? '往来' : '结算'}-${from}-${to}.csv`,
      csv: csvText([
        [
          '记录ID',
          '方向',
          '对象',
          '金额',
          '日期',
          '备注',
          ...(debt
            ? ['已结算', '减免核销', '剩余', '到期日']
            : ['已撤销', '关联往来分配']),
        ],
        ...rows.map((r) => [
          r.id,
          r.direction,
          r.counterparty,
          r.amount,
          'occurred_date' in r ? r.occurred_date : r.settled_date,
          r.note,
          ...('occurred_date' in r
            ? [r.settled, r.adjusted, r.remaining, r.due_date]
            : [r.reversed, allocations.get(r.id) ?? '[]']),
        ]),
      ]),
    }
  }
}
