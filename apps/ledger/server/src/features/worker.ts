import type { BillInput } from '@t-box/ledger-contracts'
import type { LedgerAccess } from '../ledgers/access.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { cents } from '../finance/money.js'
import { billDelta } from '../finance/service.js'
import { audit } from '../ledgers/audit.js'
import { today } from '../ledgers/validation.js'
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
    const rules = await this.access.source.query(
      'SELECT id,ledger_id,created_by FROM ledger_rules WHERE enabled=TRUE AND next_date<=? ORDER BY next_date LIMIT 100',
      [today()],
    )
    for (const row of rules) {
      try {
        await this.active?.(row.created_by)
        await this.runRule(row.id, row.ledger_id)
      } catch (e) {
        await this.access.source.query(
          'UPDATE ledger_rules SET enabled=FALSE,last_error=? WHERE id=?',
          [(e instanceof Error ? e.message : '执行失败').slice(0, 200), row.id],
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
    const debts = await this.access.source.query(
      'SELECT ledger_id,id,created_by,counterparty,direction,remaining,due_date FROM debt_positions WHERE remaining>0 AND due_date<=DATE_ADD(?,INTERVAL 3 DAY) AND created_by IS NOT NULL ORDER BY due_date LIMIT 1000',
      [today()],
    )
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
    await this.access.source.query(
      'INSERT IGNORE INTO ledger_notices(id,ledger_id,user_id,dedupe_key,title,body) VALUES(?,?,?,?,?,?)',
      [randomUUID(), book, user, key, title.slice(0, 100), body.slice(0, 400)],
    )
  }

  private async runRule(id: string, bookId: string) {
    await this.access.source.transaction(async (db) => {
      const [book] = await db.query(
        'SELECT * FROM ledgers WHERE id=? FOR UPDATE',
        [bookId],
      )
      const [r] = await db.query(
        'SELECT * FROM ledger_rules WHERE id=? AND enabled=TRUE FOR UPDATE',
        [id],
      )
      if (!book || !r || r.next_date > today()) {
        return
      }
      const [member] = await db.query(
        'SELECT m.role FROM ledger_members m JOIN app_users u ON u.id=m.user_id WHERE m.ledger_id=? AND m.user_id=? AND u.enabled=TRUE',
        [bookId, r.created_by],
      )
      if (!member || member.role === 'viewer' || Number(book.archived)) {
        invalid('authorization', '创建人已无写入权限或账本已归档')
      }
      if (Number(r.grant_version) !== Number(book.password_version)) {
        invalid('authorization', '账本密码已变更，请重新授权周期规则')
      }
      const template = parseBillInput(json(r.bill_json)) as BillInput
      const [c] = await db.query(
        'SELECT id FROM bill_categories WHERE ledger_id=? AND id=? AND type=? AND active=TRUE',
        [bookId, template.category, template.type],
      )
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
        const [done] = await db.query(
          'SELECT id FROM ledger_rule_runs WHERE rule_id=? AND occurrence_date=?',
          [id, next],
        )
        if (!done) {
          const billId = r.mode === 'automatic' ? randomUUID() : null
          if (billId) {
            await db.query(
              'INSERT INTO bills(id,ledger_id,type,amount,category,bill_date,note,created_by,account_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))',
              [
                billId,
                bookId,
                template.type,
                template.amount,
                template.category,
                next,
                template.note,
                r.created_by,
                template.accountId ?? null,
              ],
            )
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
          await db.query(
            'INSERT INTO ledger_rule_runs(id,ledger_id,rule_id,occurrence_date,bill_id,created_by) VALUES(?,?,?,?,?,?)',
            [randomUUID(), bookId, id, next, billId, r.created_by],
          )
          await db.query(
            'INSERT IGNORE INTO ledger_notices(id,ledger_id,user_id,dedupe_key,title,body) VALUES(?,?,?,?,?,?)',
            [
              randomUUID(),
              bookId,
              r.created_by,
              `rule:${id}:${next}`,
              r.mode === 'automatic' ? '周期账单已生成' : '周期记账提醒',
              `${r.name} · ${next} · ${template.amount} 元`,
            ],
          )
        }
        next = nextOccurrence(
          r.start_date,
          r.frequency,
          r.interval_count,
          next,
        )
        if (r.end_date && next > r.end_date) {
          enabled = false
        }
      }
      await db.query(
        'UPDATE ledger_rules SET next_date=?,enabled=?,last_error=NULL WHERE id=?',
        [next, enabled, id],
      )
      await db.query('UPDATE ledgers SET revision=revision+1 WHERE id=?', [
        bookId,
      ])
    })
    this.access.notify(bookId)
  }
}
