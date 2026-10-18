import type { CategoryRepository } from '../categories/repository.js'
import type { Principal } from '../ledgers/types.js'
import type { BillRepository } from '../repository.js'
import type { LedgerServices } from './ports.js'
import { object } from '@t-box/app-server-sdk'
import { digest } from '@t-box/server-foundation/crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { In } from 'typeorm'
import { DebtPositionEntity } from '../domain-entities.js'
import { attachmentIds, recordKind } from '../features/attachments.js'
import {
  confirmationLines,
  loadConfirmationLabels,
} from '../features/confirmation.js'
import { featureTools } from '../features/tools.js'
import { cents, money } from '../finance/money.js'
import { debtInput, settlementInput } from '../ledgers/validation.js'
import { parseId } from '../validation.js'

export async function chatContext(
  p: LedgerServices,
  principal: Principal,
  ledgerId: string,
  requestId: string,
) {
  const { book } = await p.access.check(principal, ledgerId, 'read', true)
  const key = (action: string, input: unknown) =>
    `chat:${requestId}:${digest(JSON.stringify({ action, input }))}`
  const bills: BillRepository = {
    async list(filters) {
      const result = await p.finance.bills(
        principal,
        ledgerId,
        Object.fromEntries(
          Object.entries(filters).map(([k, v]) => [k, String(v)]),
        ),
      )
      return { data: result.data, total: result.meta.total }
    },
    summary: (month) => p.finance.summary(principal, ledgerId, month),
    get: async (id) => p.finance.getBill(principal, ledgerId, id),
    create: (input) =>
      p.finance.createBill(principal, ledgerId, key('create', input), input),
    update: async () => {
      invalid('tool', '当前技能不支持修改账单')
    },
    delete: async () => {
      invalid('tool', '当前技能不支持删除账单')
    },
  }
  const categories: CategoryRepository = {
    list: () => p.finance.categories(principal, ledgerId),
    create: async () => {
      invalid('tool', '请在账本内创建分类')
    },
    validate: async (input) => {
      const rows = await p.finance.categories(principal, ledgerId)
      if (
        !rows.some(
          (row) =>
            row.id === input.category &&
            row.type === input.type &&
            row.active !== false,
        )
      ) {
        invalid('category', '请选择此账本有效分类')
      }
    },
  }
  const f = p.finance.features
  const featureHandlers: Record<string, (args: unknown) => Promise<unknown>> = {
    ledger_attachments_list: (args) => {
      const v = object(args, ['kind', 'recordId'])
      return f.attachments.list(
        principal,
        ledgerId,
        recordKind(v.kind),
        parseId(v.recordId),
      )
    },
    ledger_attachments_add: (args) => {
      const v = object(args, ['kind', 'recordId', 'resourceIds'])
      const ids = attachmentIds(v.resourceIds)
      if (!ids?.length) {
        invalid('resourceIds', '请选择附件')
      }
      return f.attachments.add(
        principal,
        ledgerId,
        recordKind(v.kind),
        parseId(v.recordId),
        key('attachments', args),
        ids,
      )
    },
    ledger_batch_create: (args) =>
      f.batch.create(principal, ledgerId, key('batch', args), args),
    ledger_accounts_list: () => f.accounts.list(principal, ledgerId),
    ledger_budgets_list: (args) =>
      f.planning.budgets(
        principal,
        ledgerId,
        String(object(args, ['month']).month),
      ),
    ledger_budget_save: (args) =>
      f.planning.budget(principal, ledgerId, key('budget', args), args),
    ledger_refund_create: (args) =>
      f.refunds.create(principal, ledgerId, key('refund', args), args),
    ledger_transfer_create: (args) =>
      f.accounts.transfer(principal, ledgerId, key('transfer', args), args),
    ledger_rules_list: () => f.planning.rules(principal, ledgerId),
    ledger_rule_create: (args) =>
      f.planning.createRule(principal, ledgerId, key('rule', args), args),
    ledger_templates_list: () => f.records.templates(principal, ledgerId),
    ledger_contacts_list: () => f.contacts.list(principal, ledgerId),
    ledger_aging: () => f.contacts.aging(principal, ledgerId),
    ledger_bill_detail: (args) =>
      f.records.detail(
        principal,
        ledgerId,
        String(object(args, ['billId']).billId),
      ),
    ledger_debt_adjust: (args) => {
      const { debtId, ...input } = object(args, [
        'debtId',
        'kind',
        'amount',
        'date',
        'dueDate',
        'note',
      ])
      return f.contacts.adjust(
        principal,
        ledgerId,
        String(debtId),
        key('adjust', args),
        input,
      )
    },
    ledger_reimbursement_create: (args) =>
      f.refunds.reimburse(
        principal,
        ledgerId,
        key('reimbursement', args),
        args,
      ),
    ledger_reimbursement_receive: (args) => {
      const { reimbursementId, ...input } = object(args, [
        'reimbursementId',
        'amount',
        'date',
        'note',
        'accountId',
      ])
      return f.refunds.receive(
        principal,
        ledgerId,
        String(reimbursementId),
        key('reimbursement-receive', args),
        input,
      )
    },
    ledger_import_preview: (args) =>
      f.imports.preview(principal, ledgerId, key('preview', args), args),
    ledger_import_commit: (args) => {
      const { draftId, ...input } = object(args, [
        'draftId',
        'rows',
        'allowDuplicates',
      ])
      return f.imports.commit(
        principal,
        ledgerId,
        String(draftId),
        key('import-commit', args),
        input,
      )
    },
  }
  for (const [name, tool] of Object.entries(featureTools)) {
    if (tool.needsConfirmation) {
      featureHandlers[`confirm_${name}`] = async (args) => {
        await p.access.check(principal, ledgerId, 'write')
        const properties = tool.definition.parameters.properties
        const keys =
          properties &&
          typeof properties === 'object' &&
          !Array.isArray(properties)
            ? Object.keys(properties)
            : []
        const v = object(args, keys)
        const categories = await p.finance.categories(principal, ledgerId)
        const accounts = await f.accounts.list(principal, ledgerId)
        const labels = new Map<string, string>([
          ...categories.map((c) => [c.id, c.label] as [string, string]),
          ...accounts.map((c) => [c.id, c.name] as [string, string]),
        ])
        await loadConfirmationLabels(
          p.access.source.manager,
          ledgerId,
          v,
          labels,
          principal.user.id,
        )
        // Include all rows; no truncation that could hide a financial write from consent.
        return {
          ledgerId,
          ledgerName: book.name,
          title: `确认${tool.title}`,
          lines: confirmationLines(name, v, labels),
        }
      }
    }
  }
  return {
    bills,
    categories,
    ledgerId,
    ledgerName: book.name,
    extra: {
      ...featureHandlers,
      confirm_debts_create: async (args: unknown) => {
        await p.access.check(principal, ledgerId, 'write')
        const input = debtInput(args)
        if (book.template === 'daily') {
          invalid('template', '日常账本不支持往来')
        }
        return {
          ledgerId,
          ledgerName: book.name,
          title: '确认新增往来',
          lines: [
            `${input.direction === 'receivable' ? '应收：别人欠账本' : '应付：账本欠别人'} · ${input.counterparty}`,
            `金额 ¥ ${input.amount} · ${input.date}`,
            input.cashMovement
              ? '记录本次借出/借入资金流'
              : '仅补录往来，不产生资金流',
            input.note || '无备注',
          ],
        }
      },
      confirm_settlements_create: async (args: unknown) => {
        await p.access.check(principal, ledgerId, 'write')
        const input = settlementInput(args)
        const ids = input.allocations.map((row) => row.debtId)
        const debts = (await p.access.source
          .getRepository(DebtPositionEntity)
          .find({
            select: {
              id: true,
              direction: true,
              counterparty: true,
              remaining: true,
              date: true,
              note: true,
            },
            where: { ledgerId, id: In(ids) },
          })
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              direction: row.direction,
              counterparty: row.counterparty,
              remaining: row.remaining,
              date: row.date,
              note: row.note,
            })),
          )) as {
          id: string
          direction: string
          counterparty: string
          remaining: string
          date: string
          note: string
        }[]
        const rows = input.allocations.map((allocation) => {
          const debt = debts.find((row) => row.id === allocation.debtId)
          if (!debt) {
            invalid('allocations', '往来不存在')
          }
          if (cents(allocation.amount) > cents(debt.remaining)) {
            invalid('amount', '超过剩余金额')
          }
          if (input.date < debt.date) {
            invalid('date', '收还款日期不能早于发生日期')
          }
          return { ...allocation, debt }
        })
        if (
          rows.some(
            (row) =>
              row.debt.direction !== rows[0]!.debt.direction ||
              row.debt.counterparty !== rows[0]!.debt.counterparty,
          )
        ) {
          invalid('allocations', '只能结算同一对象同一方向')
        }
        const total = money(
          rows.reduce((sum, row) => sum + cents(row.amount), 0n),
        )
        return {
          ledgerId,
          ledgerName: book.name,
          title: '确认收还款',
          lines: [
            `${rows[0]!.debt.direction === 'receivable' ? '收款' : '还款'} · ${rows[0]!.debt.counterparty}`,
            `合计 ¥ ${total} · ${input.date}`,
            ...rows.map(
              (row) =>
                `${row.debt.date} ${row.debt.note || '往来'}：本次 ${row.amount} / 剩余 ${row.debt.remaining}`,
            ),
            input.note || '无备注',
          ],
        }
      },
      debts_create: (args: unknown) =>
        p.finance.createDebt(principal, ledgerId, key('debt', args), args),
      settlements_create: (args: unknown) =>
        p.finance.settle(principal, ledgerId, key('settle', args), args),
      ledger_statistics: async (args: unknown) => {
        const { series, ...summary } = await p.statistics.get(
          principal,
          ledgerId,
          args,
        )
        return summary
      },
      debts_list: (args: unknown) => {
        const query = Object.fromEntries(
          Object.entries(args as Record<string, unknown>)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]),
        )
        return p.finance.debts(principal, ledgerId, query)
      },
    },
  }
}
