import type { LedgerTool } from '../ai/tools.js'
import { definition, nullable } from '@t-box/app-server-sdk'
import { ledgerRecordKinds } from '@t-box/ledger-contracts'
import { ErrorCode } from '../error-codes.js'

const str = { type: 'string' }
const date = { type: 'string', description: 'YYYY-MM-DD' }
const amount = {
  type: 'string',
  description: '大于零的十进制金额，最多两位小数',
}
const id = { type: 'string', description: '查询返回的真实 ID，不得猜测' }
const schema = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const attachmentResourceIds = {
  type: 'array',
  maxItems: 20,
  items: id,
  description: '用户本次指定附加的已上传资源 ID；无附件用空数组，不得猜测。',
}
const bill = {
  attachmentResourceIds,
  type: { type: 'string', enum: ['income', 'expense'] },
  amount,
  category: id,
  date,
  note: str,
  accountId: nullable(id),
}
const debt = {
  attachmentResourceIds,
  direction: { type: 'string', enum: ['receivable', 'payable'] },
  counterparty: str,
  amount,
  date,
  dueDate: nullable(date),
  note: str,
  cashMovement: { type: 'boolean' },
  accountId: nullable(id),
  contactId: nullable(id),
}
const settlement = {
  attachmentResourceIds,
  date,
  note: str,
  accountId: nullable(id),
  allocations: {
    type: 'array',
    minItems: 1,
    maxItems: 20,
    items: schema({
      debtId: {
        type: 'string',
        description: '真实往来 ID，或 ref:批内前序往来标识',
      },
      amount,
    }),
  },
}
const refund = {
  attachmentResourceIds,
  billId: {
    type: 'string',
    description: '真实支出账单 ID，或 ref:批内前序账单标识',
  },
  amount,
  date,
  note: str,
  accountId: nullable(id),
}
const transfer = {
  attachmentResourceIds,
  fromAccountId: id,
  toAccountId: id,
  amount,
  date,
  note: str,
}
export function featureTool(
  name: string,
  title: string,
  description: string,
  properties: Parameters<typeof definition>[2],
  write = false,
): LedgerTool {
  return {
    definition: definition(name, description, properties),
    title,
    execution: 'server',
    ...(write
      ? {
          capability: 'write',
          needsConfirmation: true,
          writeFingerprint: (v: unknown) => JSON.stringify(v),
        }
      : {}),
    successSummary: write ? `${title}已完成` : `${title}完成`,
    async handler(args, ctx) {
      const extra = ctx.extra as
        Record<string, (args: unknown) => Promise<unknown>> | undefined
      if (!extra?.[name]) {
        throw ErrorCode.FEATURE_UNAVAILABLE()
      }
      return extra[name]!(args)
    },
  }
}
export const featureTools: Record<string, LedgerTool> = {
  ledger_attachments_list: featureTool(
    'ledger_attachments_list',
    '查看记录附件',
    '查询指定财务记录的图片和文件；使用真实记录 ID。',
    { kind: { type: 'string', enum: ledgerRecordKinds }, recordId: id },
  ),
  ledger_attachments_add: featureTool(
    'ledger_attachments_add',
    '关联记录附件',
    '将用户本次明确指定的已上传图片或文件关联到指定记录，保留原文件；不可猜测资源或记录 ID。',
    {
      kind: { type: 'string', enum: ledgerRecordKinds },
      recordId: id,
      resourceIds: attachmentResourceIds,
    },
    true,
  ),
  ledger_batch_create: featureTool(
    'ledger_batch_create',
    '批量记录',
    '一次原子提交 1–100 笔混合记录，全部成功或全部回滚；必须明确用户意图并前端确认。items 顺序执行，ref 唯一，可用 ref:标识 引用前面新建的账单或往来。借还本金、退款、账户转账不得记成普通收入支出。',
    {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          anyOf: Object.entries({
            bill,
            debt,
            settlement,
            refund,
            transfer,
          }).map(([kind, input]) =>
            schema({
              kind: { type: 'string', enum: [kind] },
              ref: nullable(str),
              input: schema(input),
            }),
          ),
        },
      },
    },
    true,
  ),
  ledger_accounts_list: featureTool(
    'ledger_accounts_list',
    '查询资金账户',
    '读取当前账本资金账户和截至今天的余额，余额与收支结余不同。',
    {},
  ),
  ledger_budgets_list: featureTool(
    'ledger_budgets_list',
    '查询预算',
    '读取某月共同预算、分类预算及净支出使用情况。',
    { month: str },
  ),
  ledger_budget_save: featureTool(
    'ledger_budget_save',
    '设置预算',
    '设置某月账本预算或支出分类预算，需要管理员权限和前端确认。',
    { month: str, categoryId: nullable(id), amount },
    true,
  ),
  ledger_refund_create: featureTool(
    'ledger_refund_create',
    '登记退款',
    '关联真实支出账单，部分或多次退款累计不得超过原支出；减少净支出，不增加普通收入。',
    refund,
    true,
  ),
  ledger_transfer_create: featureTool(
    'ledger_transfer_create',
    '登记账户转账',
    '登记资金账户之间的转账，不进行实际付款，不计入收入支出。',
    transfer,
    true,
  ),
  ledger_rules_list: featureTool(
    'ledger_rules_list',
    '查询周期账单',
    '查询当前账本周期规则和暂停错误。',
    {},
  ),
  ledger_rule_create: featureTool(
    'ledger_rule_create',
    '创建周期账单',
    '默认建议到期提醒；automatic 必须用户明确要求自动记账，经前端确认授权后由后端定期执行，不是实际付款。',
    {
      name: str,
      bill: schema(bill),
      frequency: { type: 'string', enum: ['week', 'month', 'year'] },
      interval: { type: 'integer', minimum: 1, maximum: 99 },
      startDate: date,
      endDate: nullable(date),
      mode: { type: 'string', enum: ['remind', 'automatic'] },
    },
    true,
  ),
  ledger_templates_list: featureTool(
    'ledger_templates_list',
    '查询记账模板',
    '读取常用模板；日期要使用本次真实日期，不得直接复制旧日期。',
    {},
  ),
  ledger_contacts_list: featureTool(
    'ledger_contacts_list',
    '查询往来对象',
    '读取往来对象真实 ID 和剩余应收应付。',
    {},
  ),
  ledger_aging: featureTool(
    'ledger_aging',
    '查询账龄',
    '读取未结往来、到期日和逾期天数，可据此提醒用户。',
    {},
  ),
  ledger_bill_detail: featureTool(
    'ledger_bill_detail',
    '查看账单详情',
    '查看真实账单、退款、报销及操作记录。',
    { billId: id },
  ),
  ledger_debt_adjust: featureTool(
    'ledger_debt_adjust',
    '调整往来',
    '登记展期、减免或核销，必须明确用户要求和原因、管理员权限及前端确认。减免和核销没有资金流，不等于收还款。',
    {
      debtId: id,
      kind: { type: 'string', enum: ['extension', 'waiver', 'writeoff'] },
      amount: nullable(amount),
      date: nullable(date),
      dueDate: nullable(date),
      note: str,
    },
    true,
  ),
  ledger_reimbursement_create: featureTool(
    'ledger_reimbursement_create',
    '申请报销',
    '关联真实支出，登记报销方和申请金额，生成应收但不产生收入或现金。',
    { billId: id, counterparty: str, amount },
    true,
  ),
  ledger_reimbursement_receive: featureTool(
    'ledger_reimbursement_receive',
    '登记报销到账',
    '关联真实报销申请，部分收款减少应收及净支出，并可记入资金账户。',
    { reimbursementId: id, amount, date, note: str, accountId: nullable(id) },
    true,
  ),
  ledger_import_preview: {
    ...featureTool(
      'ledger_import_preview',
      '预览导入账单',
      '把识别出的账单创建为导入草稿；这一步不入账，返回错误和重复行，修正后再经用户确认提交。',
      {
        rows: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: schema(bill),
        },
      },
    ),
    capability: 'write',
    writeFingerprint: (v: unknown) => JSON.stringify(v),
  },
  ledger_import_commit: featureTool(
    'ledger_import_commit',
    '确认导入账单',
    '使用预览返回的 draftId 和行号，经用户确认后原子导入；重复记录必须用户明确允许。',
    {
      draftId: id,
      rows: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: schema({
          index: { type: 'integer', minimum: 1, maximum: 100 },
          input: schema(bill),
        }),
      },
      allowDuplicates: { type: 'boolean' },
    },
    true,
  ),
}
