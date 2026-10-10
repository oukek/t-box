import type { Principal } from '../ledgers/types.js'
import { ApiError, invalid } from '@t-box/server-foundation/errors'
import { validateCategoryIcon } from '../categories/icons.js'
import { object, text } from '../ledgers/validation.js'
import { rebuild } from '../statistics/projection.js'
import { parseId } from '../validation.js'
import { FeatureService, integer, notFound } from './base.js'

export class CategoryManagement extends FeatureService {
  private custom(row: any) {
    if (Number(row?.is_default)) {
      throw new ApiError(
        403,
        'SYSTEM_CATEGORY_READ_ONLY',
        '系统分类由管理后台维护，账本内不可修改、删除或合并',
      )
    }
  }

  async update(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'label',
      'icon',
      'iconId',
      'active',
      'pinned',
      'sortOrder',
    ])
    return this.finance.operations.run(
      actor,
      book,
      key,
      'category.updated',
      { id, ...v },
      async (db, a) => {
        this.manage(a)
        const [r] = await db.query(
          'SELECT * FROM bill_categories WHERE ledger_id=? AND id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        this.custom(r)
        for (const f of ['active', 'pinned']) {
          if (v[f] !== undefined && typeof v[f] !== 'boolean') {
            invalid(f, '请选择有效状态')
          }
        }
        const icon = v.icon === undefined ? r.icon : text(v.icon, '图标', 32)
        await db.query(
          'UPDATE bill_categories SET label=?,icon=?,icon_id=?,active=?,pinned=?,sort_order=? WHERE id=?',
          [
            v.label === undefined ? r.label : text(v.label, '分类名称', 40),
            icon,
            v.iconId === undefined
              ? r.icon_id
              : await validateCategoryIcon(db, book, actor.user.id, v.iconId),
            v.active ?? r.active,
            v.pinned ?? r.pinned,
            v.sortOrder === undefined
              ? r.sort_order
              : integer(v.sortOrder, '排序', 0, 100000),
            id,
          ],
        )
        return { id }
      },
    )
  }

  async remove(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'category.deleted',
      { id },
      async (db, a) => {
        this.manage(a)
        const [r] = await db.query(
          'SELECT * FROM bill_categories WHERE ledger_id=? AND id=?',
          [book, id],
        )
        if (!r) {
          notFound()
        }
        this.custom(r)
        const [count] = await db.query(
          'SELECT (SELECT COUNT(*) FROM bills WHERE ledger_id=? AND category=?)+(SELECT COUNT(*) FROM ledger_events WHERE ledger_id=? AND category_id=?) AS n',
          [book, id, book, id],
        )
        if (Number(count.n)) {
          invalid('category', '此分类存在历史记录，请停用或合并，不能删除')
        }
        const [refs] = await db.query(
          'SELECT (SELECT COUNT(*) FROM ledger_budgets WHERE ledger_id=? AND category_id=?)+(SELECT COUNT(*) FROM ledger_templates WHERE ledger_id=? AND JSON_UNQUOTE(JSON_EXTRACT(bill_json,\'$.category\'))=?)+(SELECT COUNT(*) FROM ledger_rules WHERE ledger_id=? AND JSON_UNQUOTE(JSON_EXTRACT(bill_json,\'$.category\'))=?) AS n',
          [book, id, book, id, book, id],
        )
        if (Number(refs.n)) {
          invalid('category', '此分类已用于预算、模板或周期规则，请先调整')
        }
        await db.query('DELETE FROM bill_categories WHERE id=?', [id])
        return { id }
      },
    )
  }

  async merge(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['targetId'])
    const target = parseId(v.targetId)
    if (id === target) {
      invalid('targetId', '不能合并到自身')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'category.merged',
      { id, target },
      async (db, a) => {
        this.manage(a)
        const rows = await db.query(
          'SELECT * FROM bill_categories WHERE ledger_id=? AND id IN (?,?)',
          [book, id, target],
        )
        if (rows.length !== 2 || rows[0].type !== rows[1].type) {
          invalid('targetId', '只能合并同一账本同一收支类型的分类')
        }
        this.custom(rows.find((r: any) => r.id === id))
        const [t] = rows.filter((r: any) => r.id === target)
        if (!Number(t.active)) {
          invalid('targetId', '目标分类已停用')
        }
        await db.query(
          'UPDATE bills SET category=? WHERE ledger_id=? AND category=?',
          [target, book, id],
        )
        await db.query(
          'UPDATE ledger_events SET category_id=? WHERE ledger_id=? AND category_id=?',
          [target, book, id],
        )
        const budgets = await db.query(
          'SELECT * FROM ledger_budgets WHERE ledger_id=? AND category_id=?',
          [book, id],
        )
        for (const b of budgets) {
          const [targetBudget] = await db.query(
            'SELECT id FROM ledger_budgets WHERE ledger_id=? AND category_id=? AND budget_month=?',
            [book, target, b.budget_month],
          )
          if (targetBudget) {
            await db.query(
              'UPDATE ledger_budgets SET amount=amount+? WHERE id=?',
              [b.amount, targetBudget.id],
            )
            await db.query('DELETE FROM ledger_budgets WHERE id=?', [b.id])
          } else {
            await db.query(
              'UPDATE ledger_budgets SET category_id=? WHERE id=?',
              [target, b.id],
            )
          }
        }
        for (const table of ['ledger_templates', 'ledger_rules']) {
          await db.query(
            `UPDATE ${table} SET bill_json=JSON_SET(bill_json,'$.category',?) WHERE ledger_id=? AND JSON_UNQUOTE(JSON_EXTRACT(bill_json,'$.category'))=?`,
            [target, book, id],
          )
        }
        const recents = await db.query(
          'SELECT user_id,last_used_at,created_by FROM ledger_category_recents WHERE ledger_id=? AND category_id=?',
          [book, id],
        )
        for (const r of recents) {
          await db.query(
            'INSERT INTO ledger_category_recents(id,ledger_id,user_id,category_id,last_used_at,created_by) VALUES(UUID(),?,?,?,?,?) ON DUPLICATE KEY UPDATE last_used_at=GREATEST(last_used_at,VALUES(last_used_at))',
            [book, r.user_id, target, r.last_used_at, r.created_by],
          )
        }
        await db.query(
          'DELETE FROM ledger_category_recents WHERE ledger_id=? AND category_id=?',
          [book, id],
        )
        await db.query('UPDATE bill_categories SET active=FALSE WHERE id=?', [
          id,
        ])
        await rebuild(db, book)
        return { id, targetId: target }
      },
    )
  }

  async recent(actor: Principal, book: string) {
    await this.read(actor, book)
    return this.db.query(
      'SELECT category_id AS categoryId FROM ledger_category_recents WHERE ledger_id=? AND user_id=? ORDER BY last_used_at DESC LIMIT 12',
      [book, actor.user.id],
    )
  }
}
