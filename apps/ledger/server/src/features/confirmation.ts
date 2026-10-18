import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { In, IsNull } from 'typeorm'
import { DebtPositionEntity } from '../domain-entities.js'
import { BillEntity } from '../entities.js'
import { LedgerReimbursementEntity } from '../persistence/refunds-entities.js'
/** Human-readable confirmation stays in the app, alongside its domain operations. */
export function confirmationLines(
  name: string,
  value: Record<string, unknown>,
  labels: Map<string, string>,
) {
  const label = (id: unknown) =>
    id
      ? (labels.get(String(id)) ??
        (String(id).startsWith('ref:')
          ? `本批 [${String(id).slice(4)}] 记录`
          : String(id)))
      : '未指定'
  const names: Record<string, string> = {
    bill: '收支',
    debt: '往来',
    settlement: '收还款',
    refund: '退款',
    transfer: '账户转账',
  }
  const describeBase = (kind: string, input: Record<string, unknown>) => {
    const sum = input.amount ? `¥ ${input.amount}` : ''
    const date = input.date ?? input.month ?? ''
    if (kind === 'bill') {
      return `${input.type === 'income' ? '收入' : '支出'} ${sum} · ${label(input.category)} · ${date} · ${label(input.accountId)}${input.note ? ' · ' + input.note : ''}`
    }
    if (kind === 'debt') {
      return `${input.direction === 'receivable' ? '应收' : '应付'} ${sum} · ${input.counterparty} · ${date} · ${input.cashMovement ? '有资金流' : '仅补录，不产生资金流'}${input.dueDate ? ' · 到期 ' + input.dueDate : ''} · ${label(input.accountId)}${input.note ? ' · ' + input.note : ''}`
    }
    if (kind === 'settlement') {
      return `收还款 · ${date} · ${label(input.accountId)} · ${((input.allocations as Record<string, unknown>[]) ?? []).map((a) => `${label(a.debtId)} ¥ ${a.amount}`).join('；')}${input.note ? ' · ' + input.note : ''}`
    }
    if (kind === 'refund') {
      return `退款 ${sum} · 原支出 ${label(input.billId)} · ${date} · ${label(input.accountId)}${input.note ? ' · ' + input.note : ''}`
    }
    if (kind === 'transfer') {
      return `转账 ${sum} · ${label(input.fromAccountId)} → ${label(input.toAccountId)} · ${date}${input.note ? ' · ' + input.note : ''}`
    }
    const fields: Record<string, string> = {
      amount: '金额',
      date: '日期',
      month: '月份',
      categoryId: '分类',
      accountId: '账户',
      counterparty: '对象',
      note: '备注',
      dueDate: '到期日',
      kind: '调整方式',
      billId: '原支出',
      reimbursementId: '报销申请',
    }
    return Object.entries(input)
      .filter(([k, v]) => k in fields && v !== null && v !== '')
      .map(
        ([k, v]) =>
          `${fields[k]}：${k.endsWith('Id') ? label(v) : k === 'kind' ? ({ extension: '展期', waiver: '减免', writeoff: '核销' }[String(v)] ?? v) : v}`,
      )
      .join(' · ')
  }
  const describe = (kind: string, input: Record<string, unknown>) => {
    const ids = input.attachmentResourceIds
    return (
      describeBase(kind, input) +
      (Array.isArray(ids) && ids.length
        ? ` · 附件 ${ids.length} 个：${ids.map((id) => label(id).slice(0, 50)).join('、')}`
        : '')
    )
  }
  if (name === 'ledger_attachments_add') {
    return [
      `关联至 ${value.kind} 记录：${label(value.recordId)}`,
      ...((value.resourceIds as string[]) ?? []).map(
        (id) => `附件：${label(id)}`,
      ),
    ]
  }
  if (name === 'ledger_rule_create') {
    return [
      `规则：${value.name} · 每 ${value.interval} ${{ week: '周', month: '月', year: '年' }[String(value.frequency)] ?? value.frequency}`,
      `开始 ${value.startDate} · 结束 ${value.endDate ?? '不限'} · ${value.mode === 'automatic' ? '授权后端自动记账（包括补生成），不实际付款' : '仅到期提醒，不自动记账'}`,
      describe('bill', value.bill as Record<string, unknown>),
    ]
  }
  if (name === 'ledger_import_commit') {
    return [
      `导入草稿：${value.draftId} · ${value.allowDuplicates ? '允许重复记录' : '拒绝重复记录'}`,
      ...(
        value.rows as { index: number, input: Record<string, unknown> }[]
      ).map((r) => `${r.index}. ${describe('bill', r.input)}`),
      '全部成功才入账，任意一笔失败整批回滚。',
    ]
  }
  if (name === 'ledger_batch_create') {
    return [
      ...(
        value.items as {
          kind: string
          ref?: string
          input: Record<string, unknown>
        }[]
      ).map(
        (r, i) =>
          `${i + 1}. ${names[r.kind] ?? r.kind}${r.ref ? ' [' + r.ref + ']' : ''} · ${describe(r.kind, r.input)}`,
      ),
      '全部成功才入账，任意一笔失败整批回滚。',
    ]
  }
  const kinds: Record<string, string> = {
    ledger_refund_create: 'refund',
    ledger_transfer_create: 'transfer',
  }
  return [describe(kinds[name] ?? name, value)]
}

/** Only resolve records referenced by this proposal, always within its authorized book. */
export async function loadConfirmationLabels(
  db: import('typeorm').EntityManager,
  book: string,
  value: unknown,
  initial: Map<string, string>,
  userId?: string,
) {
  const ids = new Set<string>()
  const pending: unknown[] = [value]
  while (pending.length) {
    const v = pending.pop()
    if (
      typeof v === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
    ) {
      ids.add(v)
    } else if (v && typeof v === 'object') {
      pending.push(...Object.values(v))
    }
  }
  if (!ids.size) {
    return initial
  }
  const values = [...ids]
  if (userId) {
    for (const r of await db.getRepository(ResourceEntity).find({
      select: { id: true, name: true },
      where: { user_id: userId, deleted_at: IsNull(), id: In(values) },
    })) {
      initial.set(r.id, r.name)
    }
  }
  const [bills, debts, reimbursements] = await Promise.all([
    db
      .getRepository(BillEntity)
      .find({
        select: { id: true, date: true, amount: true, note: true },
        where: { ledgerId: book, id: In(values) },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          date: row.date,
          amount: row.amount,
          note: row.note,
        })),
      ),
    db
      .getRepository(DebtPositionEntity)
      .find({
        select: {
          id: true,
          counterparty: true,
          direction: true,
          remaining: true,
        },
        where: { ledgerId: book, id: In(values) },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          counterparty: row.counterparty,
          direction: row.direction,
          remaining: row.remaining,
        })),
      ),
    db.getRepository(LedgerReimbursementEntity).find({
      select: { id: true, counterparty: true, amount: true, received: true },
      where: { ledger_id: book, id: In(values) },
    }),
  ])
  for (const r of bills) {
    initial.set(r.id, `${r.date} ${r.note || '支出'} ¥ ${r.amount}`)
  }
  for (const r of debts) {
    initial.set(
      r.id,
      `${r.counterparty} ${r.direction === 'receivable' ? '应收' : '应付'} 剩余 ${r.remaining}`,
    )
  }
  for (const r of reimbursements) {
    initial.set(r.id, `${r.counterparty} 报销 ${r.amount} 已到 ${r.received}`)
  }
  return initial
}
