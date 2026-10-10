import type {
  DebtInput,
  LedgerInput,
  LedgerRole,
  SettlementInput,
} from '@t-box/ledger-contracts'
import { password } from '@t-box/server-foundation/auth'
import { invalid } from '@t-box/server-foundation/errors'
import { object, text } from '@t-box/server-foundation/input'
import { attachmentIds } from '../features/attachment-input.js'
import { amount } from '../finance/money.js'
import { parseBillInput, parseId } from '../validation.js'

export { object, text } from '@t-box/server-foundation/input'
export function note(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) {
    invalid('note', '备注最多 200 字')
  }
  return value.trim()
}
export function date(value: unknown): string {
  return parseBillInput({ date: value }, true).date!
}
export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(
    new Date(),
  )
}
export function financialDate(value: unknown): string {
  const result = date(value)
  if (result > today()) {
    invalid('date', '往来记录不能晚于今天；计划事项请在到期日填写')
  }
  return result
}
export function ledgerInput(value: unknown): LedgerInput {
  const input = object(value, ['name', 'template', 'password'])
  if (!['daily', 'debt', 'combined'].includes(input.template as string)) {
    invalid('template', '请选择账本类型')
  }
  return {
    name: text(input.name, '账本名称', 40),
    template: input.template as LedgerInput['template'],
    ...(input.password === undefined
      ? {}
      : { password: password(input.password) }),
  }
}
export function memberRole(value: unknown): Exclude<LedgerRole, 'owner'> {
  if (!['admin', 'editor', 'viewer'].includes(value as string)) {
    invalid('role', '成员角色无效')
  }
  return value as Exclude<LedgerRole, 'owner'>
}
export function debtInput(value: unknown): DebtInput {
  const input = object(value, [
    'direction',
    'counterparty',
    'amount',
    'date',
    'dueDate',
    'note',
    'cashMovement',
    'accountId',
    'contactId',
    'attachmentResourceIds',
  ])
  if (input.direction !== 'receivable' && input.direction !== 'payable') {
    invalid('direction', '请选择应收或应付')
  }
  if (typeof input.cashMovement !== 'boolean') {
    invalid('cashMovement', '请选择本次借出/借入或补录往来')
  }
  const occurred = financialDate(input.date)
  const due = input.dueDate === null ? null : date(input.dueDate)
  if (due && due < occurred) {
    invalid('dueDate', '到期日期不能早于发生日期')
  }
  return {
    attachmentResourceIds: attachmentIds(input.attachmentResourceIds),
    direction: input.direction,
    counterparty: text(input.counterparty, '往来对象', 80),
    amount: amount(input.amount),
    date: occurred,
    dueDate: due,
    note: note(input.note),
    cashMovement: input.cashMovement,
    ...(input.accountId === undefined
      ? {}
      : {
          accountId: input.accountId === null ? null : parseId(input.accountId),
        }),
    ...(input.contactId === undefined
      ? {}
      : {
          contactId: input.contactId === null ? null : parseId(input.contactId),
        }),
  }
}
export function settlementInput(value: unknown): SettlementInput {
  const input = object(value, [
    'date',
    'note',
    'allocations',
    'accountId',
    'attachmentResourceIds',
  ])
  if (
    !Array.isArray(input.allocations) ||
    input.allocations.length < 1 ||
    input.allocations.length > 20
  ) {
    invalid('allocations', '每次请选择 1–20 笔往来')
  }
  const allocations = input.allocations.map((row) => {
    const item = object(row, ['debtId', 'amount'])
    return { debtId: parseId(item.debtId), amount: amount(item.amount) }
  })
  if (new Set(allocations.map((row) => row.debtId)).size !== allocations.length) {
    invalid('allocations', '同一笔往来不能重复分配')
  }
  return {
    attachmentResourceIds: attachmentIds(input.attachmentResourceIds),
    date: financialDate(input.date),
    note: note(input.note),
    allocations,
    ...(input.accountId === undefined
      ? {}
      : {
          accountId: input.accountId === null ? null : parseId(input.accountId),
        }),
  }
}
