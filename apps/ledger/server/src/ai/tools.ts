import type { ApplicationToolRegistration as ToolRegistration } from '@t-box/app-server-sdk'
import type { BillInput } from '@t-box/ledger-contracts'
import type { CategoryRepository } from '../categories/repository.js'
import type { BillRepository } from '../repository.js'
import type { chatContext } from './context.js'
import { definition, nullable, object } from '@t-box/app-server-sdk'
import { invalid } from '@t-box/server-foundation/errors'
import { ErrorCode } from '../error-codes.js'
import { featureTools } from '../features/tools.js'
import { debtInput, settlementInput } from '../ledgers/validation.js'
import {
  parseBillInput,
  parseListFilters,
  parseSummaryQuery,
} from '../validation.js'

const monthSchema = {
  type: 'string',
  pattern: '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$',
}
export type LedgerContext =
  | Awaited<ReturnType<typeof chatContext>> |
  {
    bills: BillRepository
    categories?: CategoryRepository
    extra?: Record<string, (args: unknown) => Promise<unknown>>
  }
export type LedgerTool = Omit<
  ToolRegistration,
  'effect' | 'handler' | 'confirm'
> & {
  capability?: 'read' | 'write'
  needsConfirmation?: boolean
  handler: (value: unknown, context: LedgerContext) => Promise<unknown>
}
export const ledgerTools: Record<string, LedgerTool> = {
  ...featureTools,
  debts_create: {
    definition: definition(
      'debts_create',
      '在当前账本建立应收或应付，后端会先请求用户在界面确认，未经确认不会保存。',
      {
        direction: { type: 'string', enum: ['receivable', 'payable'] },
        counterparty: { type: 'string', maxLength: 80 },
        amount: { type: 'string' },
        date: { type: 'string' },
        dueDate: nullable({ type: 'string' }),
        note: { type: 'string', maxLength: 200 },
        cashMovement: {
          type: 'boolean',
          description:
            '本次借出/借入为 true；补录已有往来为 false，必须明确询问',
        },
      },
    ),
    title: '登记往来',
    execution: 'server',

    capability: 'write',
    needsConfirmation: true,
    successSummary: '往来已保存',
    writeFingerprint: (value) => JSON.stringify(debtInput(value)),
    async handler(args, ctx) {
      if (!ctx.extra) {
        throw ErrorCode.UNAVAILABLE()
      }
      return ctx.extra.debts_create!(debtInput(args))
    },
  },
  settlements_create: {
    definition: definition(
      'settlements_create',
      '对 debts_list 返回的真实往来登记收款或还款，需前端确认；可以部分结算同一对象同一方向的多笔往来。',
      {
        date: { type: 'string' },
        note: { type: 'string', maxLength: 200 },
        allocations: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              debtId: { type: 'string' },
              amount: { type: 'string' },
            },
            required: ['debtId', 'amount'],
            additionalProperties: false,
          },
        },
      },
    ),
    title: '登记收还款',
    execution: 'server',

    capability: 'write',
    needsConfirmation: true,
    successSummary: '收还款已保存',
    writeFingerprint: (value) => JSON.stringify(settlementInput(value)),
    async handler(args, ctx) {
      if (!ctx.extra) {
        throw ErrorCode.UNAVAILABLE()
      }
      return ctx.extra.settlements_create!(settlementInput(args))
    },
  },
  ledger_statistics: {
    definition: definition(
      'ledger_statistics',
      '按日、月、季度、年统计当前账本普通收支、资金流和期初/期末/当前剩余应收应付。',
      {
        period: { type: 'string', enum: ['day', 'month', 'quarter', 'year'] },
        value: {
          type: 'string',
          description: 'YYYY-MM-DD、YYYY-MM、YYYY-Q1 或 YYYY',
        },
      },
    ),
    title: '统计账本',
    execution: 'server',

    successSummary: '统计完成',
    async handler(args, ctx) {
      if (!ctx.extra) {
        throw ErrorCode.UNAVAILABLE('账本统计未启用')
      }
      return ctx.extra.ledger_statistics!(args)
    },
  },
  debts_list: {
    definition: definition(
      'debts_list',
      '查询当前账本往来及剩余应收应付。金额不计入普通收支。',
      {
        direction: nullable({
          type: 'string',
          enum: ['receivable', 'payable'],
        }),
        status: nullable({ type: 'string', enum: ['open', 'settled'] }),
        q: nullable({ type: 'string', maxLength: 80 }),
        page: nullable({ type: 'integer', minimum: 1, maximum: 1000000 }),
        pageSize: nullable({ type: 'integer', minimum: 1, maximum: 100 }),
      },
    ),
    title: '查询往来',
    execution: 'server',

    successSummary: '往来查询完成',
    async handler(args, ctx) {
      if (!ctx.extra) {
        throw ErrorCode.UNAVAILABLE()
      }
      const input = object(args, [
        'direction',
        'status',
        'q',
        'page',
        'pageSize',
      ])
      return ctx.extra.debts_list!(
        Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)),
      )
    },
  },
  categories_list: {
    definition: definition(
      'categories_list',
      '读取当前账本的收入与支出分类，创建账单前必须选择有效分类 ID。',
      {},
    ),
    title: '读取记账分类',
    execution: 'server',

    successSummary: '分类已读取',
    async handler(value, { categories }) {
      object(value, [])
      if (!categories) {
        throw ErrorCode.CATEGORIES_UNAVAILABLE()
      }
      return categories.list()
    },
  },
  bills_create: {
    definition: definition(
      'bills_create',
      '仅在用户明确要求且金额无歧义时新增一笔账单。金额字符串，不支持修改删除，不得自动重复写入。',
      {
        type: { type: 'string', enum: ['income', 'expense'] },
        amount: {
          type: 'string',
          pattern: '^(0|[1-9][0-9]{0,8})(\\.[0-9]{1,2})?$',
        },
        category: {
          type: 'string',
          description: '从 categories_list 返回的同收支类型分类中选择 ID',
          maxLength: 36,
        },
        date: { type: 'string', pattern: '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' },
        note: { type: 'string', maxLength: 200 },
      },
    ),
    title: '记录账单',
    execution: 'server',

    capability: 'write',
    successSummary: '账单已保存',
    writeFingerprint: (value) => JSON.stringify(parseBillInput(value)),
    async handler(value, { bills, categories }) {
      const input = parseBillInput(value) as BillInput
      if (!categories) {
        throw ErrorCode.CATEGORIES_UNAVAILABLE()
      }
      await categories.validate(input)
      return bills.create(input)
    },
  },
  bills_list: {
    definition: definition(
      'bills_list',
      '查询账单。可选过滤字段传 null；page/pageSize 为整数或 null。',
      {
        month: nullable(monthSchema),
        type: nullable({ type: 'string', enum: ['income', 'expense'] }),
        q: nullable({ type: 'string', maxLength: 100 }),
        page: nullable({ type: 'integer', minimum: 1, maximum: 1_000_000 }),
        pageSize: nullable({ type: 'integer', minimum: 1, maximum: 100 }),
      },
    ),
    title: '查询账单',
    execution: 'server',

    successSummary: '查询完成',
    async handler(value, { bills }) {
      const args = object(value, ['month', 'type', 'q', 'page', 'pageSize'])
      const query: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(args)) {
        if (entry === null) {
          continue
        }
        if (key === 'page' || key === 'pageSize') {
          if (typeof entry !== 'number' || !Number.isInteger(entry)) {
            invalid(key, '分页参数必须为整数')
          }
          query[key] = String(entry)
        } else {
          query[key] = entry
        }
      }
      const filters = parseListFilters(query)
      const list = await bills.list(filters)
      return {
        data: list.data,
        meta: {
          total: list.total,
          page: filters.page,
          pageSize: filters.pageSize,
        },
      }
    },
  },
  bills_summary: {
    definition: definition(
      'bills_summary',
      '汇总当月收入、支出、结余。month=null 表示全部月份。',
      { month: nullable(monthSchema) },
    ),
    title: '汇总收支',
    execution: 'server',

    successSummary: '汇总完成',
    async handler(value, { bills }) {
      const args = object(value, ['month'])
      return bills.summary(parseSummaryQuery(args.month === null ? {} : args))
    },
  },
}
