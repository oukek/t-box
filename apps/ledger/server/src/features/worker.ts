import type { BillInput } from '@t-box/ledger-contracts'
import type { LedgerAccess } from '../ledgers/access.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { sqlClock } from '@t-box/server-foundation/persistence/columns'
import { LessThanOrEqual } from 'typeorm'
import { LedgerEntity } from '../domain-entities.js'
import { BillEntity, CategoryEntity } from '../entities.js'
import { cents } from '../finance/money.js'
import { billDelta } from '../finance/service.js'
import { audit } from '../ledgers/audit.js'
import { today } from '../ledgers/validation.js'
import {
  LedgerRuleEntity,
  LedgerRuleRunEntity,
} from '../persistence/planning-entities.js'
import { monthBounds, parseBillInput } from '../validation.js'
import { activeAccount } from './account-posting.js'
import { json } from './base.js'
import { nextOccurrence } from './planning.js'

export class LedgerScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private running: Promise<void> | undefined
  constructor(
    readonly access: LedgerAccess,
    readonly active?: (userId: string) => Promise<unknown>,
    readonly onError: (error: unknown) => void = () => {},
  ) {}

  start() {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      void this.tick().catch(this.onError)
    }, 60000)
    this.timer.unref()
    void this.tick().catch(this.onError)
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = undefined
    await this.running
  }

  tick() {
    if (this.running) {
      return this.running
    }
    const run = this.execute()
    this.running = run
    run
      .finally(() => {
        if (this.running === run) {
          this.running = undefined
        }
      })
      .catch(() => {})
    return run
  }

  private async execute() {
    const rules = await this.access.source
      .getRepository(LedgerRuleEntity)
      .find({
        select: { id: true, ledger_id: true, created_by: true },
        where: { enabled: true, next_date: LessThanOrEqual(today()) },
        order: { next_date: 'ASC' },
        take: 100,
      })
    for (const row of rules) {
      if (!row.created_by) {
        await this.access.source
          .getRepository(LedgerRuleEntity)
          .update(
            { id: row.id },
            { enabled: false, last_error: '创建账号已注销' },
          )
        continue
      }
      try {
        await this.active?.(row.created_by)
        await this.runRule(row.id, row.ledger_id)
      } catch (e) {
        await this.access.source.getRepository(LedgerRuleEntity).update(
          { id: row.id },
          {
            enabled: false,
            last_error: (e instanceof Error ? e.message : '执行失败').slice(
              0,
              200,
            ),
          },
        )
        await this.notice(
          row.ledger_id,
          row.created_by,
          `rule-error:${row.id}:${today()}`,
          '周期账单已暂停',
          '请在周期账单页面检查错误并重新开启。',
        )
      }
    }
    const month = today().slice(0, 7)
    const [start, end] = monthBounds(month)
    // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
    const budgets = await this.access.source.query(
      'SELECT b.id,b.ledger_id,b.created_by,b.amount,c.label,COALESCE((SELECT SUM(s.amount) FROM ledger_daily_categories s WHERE s.ledger_id=b.ledger_id AND s.type=\'expense\' AND s.stat_date BETWEEN ? AND ? AND (b.category_id=\'\' OR s.category_id=b.category_id)),0) AS spent FROM ledger_budgets b JOIN ledgers l ON l.id=b.ledger_id AND l.archived=FALSE JOIN ledger_members m ON m.ledger_id=b.ledger_id AND m.user_id=b.created_by LEFT JOIN bill_categories c ON c.id=b.category_id WHERE b.budget_month=?',
      [start, end, month],
    )
    for (const b of budgets) {
      const spent = cents(b.spent)
      const limit = cents(b.amount)
      if (spent * 100n >= limit * 80n) {
        const over = spent >= limit
        await this.notice(
          b.ledger_id,
          b.created_by,
          `budget:${b.id}:${month}:${over ? '100' : '80'}`,
          over ? '预算已用完' : '预算已使用 80%',
          `${b.label ?? '账本总预算'} · 已用 ${b.spent} / ${b.amount} 元`,
        )
      }
    }
    const debts = await this.access.source
      .createQueryBuilder()
      .select(
        'ledger_id,id,created_by,counterparty,direction,remaining,due_date',
      )
      .from('debt_positions', 'debt_positions')
      .where(
        'remaining>0 AND due_date<=DATE_ADD(:p0,INTERVAL 3 DAY) AND created_by IS NOT NULL',
      )
      .orderBy('due_date', 'ASC')
      .limit(1000)
      .setParameters({ p0: today() })
      .getRawMany()
    for (const d of debts) {
      await this.notice(
        d.ledger_id,
        d.created_by,
        `debt:${d.id}:${today()}`,
        d.due_date < today() ? '往来已逾期' : '往来即将到期',
        `${d.counterparty} · ${d.direction === 'receivable' ? '应收' : '应付'} ${d.remaining} 元 · ${d.due_date}`,
      )
    }
  }

  async notice(
    book: string,
    user: string,
    key: string,
    title: string,
    body: string,
  ) {
    await this.access.source
      .createQueryBuilder()
      .insert()
      .into('ledger_notices')
      .values({
        id: randomUUID(),
        ledger_id: book,
        user_id: user,
        dedupe_key: key,
        title: title.slice(0, 100),
        body: body.slice(0, 400),
      })
      .updateEntity(false)
      .orIgnore()
      .execute()
  }

  private async runRule(id: string, bookId: string) {
    await this.access.source.transaction(async (db) => {
      const book = await db
        .getRepository(LedgerEntity)
        .findOne({
          select: {
            id: true,
            name: true,
            template: true,
            currency: true,
            ownerId: true,
            archived: true,
            passwordHash: true,
            passwordVersion: true,
            revision: true,
            createdAt: true,
          },
          where: { id: bookId },
          lock: { mode: 'pessimistic_write' },
        })
        .then((row) =>
          row
            ? {
                id: row.id,
                name: row.name,
                template: row.template,
                currency: row.currency,
                owner_id: row.ownerId,
                archived: row.archived,
                password_hash: row.passwordHash,
                password_version: row.passwordVersion,
                revision: row.revision,
                created_at: sqlClock(row.createdAt),
              }
            : null,
        )
      const r = await db.getRepository(LedgerRuleEntity).findOne({
        select: {
          id: true,
          ledger_id: true,
          name: true,
          bill_json: true,
          frequency: true,
          interval_count: true,
          start_date: true,
          next_date: true,
          end_date: true,
          mode: true,
          grant_version: true,
          enabled: true,
          last_error: true,
          created_by: true,
          created_at: true,
        },
        where: { id, enabled: true },
        lock: { mode: 'pessimistic_write' },
      })
      if (!book || !r || !r.created_by || r.next_date > today()) {
        return
      }
      const [member] = await db
        .createQueryBuilder()
        .select('m.role', 'role')
        .from('ledger_members', 'm')
        .innerJoin('app_users', 'u', 'u.id=m.user_id')
        .where('m.ledger_id=:p0 AND m.user_id=:p1 AND u.enabled=TRUE')
        .setParameters({ p0: bookId, p1: r.created_by })
        .getRawMany()
      if (!member || member.role === 'viewer' || Number(book.archived)) {
        invalid('authorization', '创建人已无写入权限或账本已归档')
      }
      if (Number(r.grant_version) !== Number(book.password_version)) {
        invalid('authorization', '账本密码已变更，请重新授权周期规则')
      }
      const template = parseBillInput(json(r.bill_json)) as BillInput
      const c = await db
        .getRepository(CategoryEntity)
        .findOne({
          select: { id: true },
          where: {
            ledgerId: bookId,
            id: template.category,
            type: template.type,
            active: true,
          },
        })
        .then((row) => (row ? { id: row.id } : null))
      if (!c) {
        invalid('category', '周期账单分类已停用')
      }
      await activeAccount(db, bookId, template.accountId)
      let next = r.next_date
      let enabled = true
      for (let i = 0; i < 25 && next <= today(); i++) {
        if (r.end_date && next > r.end_date) {
          enabled = false
          break
        }
        const done = await db.getRepository(LedgerRuleRunEntity).findOne({
          select: { id: true },
          where: { rule_id: id, occurrence_date: next },
        })
        if (!done) {
          const billId = r.mode === 'automatic' ? randomUUID() : null
          if (billId) {
            await db.getRepository(BillEntity).insert({
              id: billId,
              ledgerId: bookId,
              type: template.type,
              amount: template.amount,
              category: template.category,
              date: next,
              note: template.note,
              createdBy: r.created_by,
              accountId: template.accountId ?? null,
              createdAt: () => 'UTC_TIMESTAMP(3)',
              updatedAt: () => 'UTC_TIMESTAMP(3)',
            })
            await billDelta(
              db,
              bookId,
              {
                ...template,
                id: billId,
                date: next,
                createdAt: '',
                updatedAt: '',
              },
              r.created_by,
            )
            await audit(db, bookId, r.created_by, 'bill.scheduled', billId, {
              ruleId: id,
              date: next,
            })
          }
          await db.getRepository(LedgerRuleRunEntity).insert({
            id: randomUUID(),
            ledger_id: bookId,
            rule_id: id,
            occurrence_date: next,
            bill_id: billId,
            created_by: r.created_by,
          })
          await db
            .createQueryBuilder()
            .insert()
            .into('ledger_notices')
            .values({
              id: randomUUID(),
              ledger_id: bookId,
              user_id: r.created_by,
              dedupe_key: `rule:${id}:${next}`,
              title: r.mode === 'automatic' ? '周期账单已生成' : '周期记账提醒',
              body: `${r.name} · ${next} · ${template.amount} 元`,
            })
            .updateEntity(false)
            .orIgnore()
            .execute()
        }
        next = nextOccurrence(r.start_date, r.frequency, r.interval_count, next)
        if (r.end_date && next > r.end_date) {
          enabled = false
        }
      }
      await db
        .getRepository(LedgerRuleEntity)
        .update({ id }, { next_date: next, enabled, last_error: null })
      await db
        .getRepository(LedgerEntity)
        .update({ id: bookId }, { revision: () => 'revision+1' })
    })
    this.access.notify(bookId)
  }
}
