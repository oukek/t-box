import type { Principal } from '../ledgers/types.js'
import { invalid } from '@t-box/server-foundation/errors'
import { booleanValue } from '@t-box/server-foundation/input'
import { In } from 'typeorm'
import { validateCategoryIcon } from '../categories/icons.js'
import { LedgerEventEntity } from '../domain-entities.js'
import { BillEntity, CategoryEntity } from '../entities.js'
import { ErrorCode } from '../error-codes.js'
import { object, text } from '../ledgers/validation.js'
import { LedgerCategoryRecentEntity } from '../persistence/categories-entities.js'
import { LedgerBudgetEntity } from '../persistence/planning-entities.js'
import { rebuild } from '../statistics/projection.js'
import { parseId } from '../validation.js'
import { FeatureService, integer, notFound } from './base.js'

export class CategoryManagement extends FeatureService {
  private custom(row: { is_default: number | boolean } | null | undefined) {
    if (Number(row?.is_default)) {
      throw ErrorCode.SYSTEM_CATEGORY_READ_ONLY()
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
        const r = await db
          .getRepository(CategoryEntity)
          .findOne({
            select: {
              id: true,
              ledgerId: true,
              sortOrder: true,
              active: true,
              pinned: true,
              presetId: true,
              iconId: true,
              type: true,
              label: true,
              icon: true,
              isDefault: true,
            },
            where: { ledgerId: book, id },
          })
          .then((row) =>
            row
              ? {
                  id: row.id,
                  ledger_id: row.ledgerId,
                  sort_order: row.sortOrder,
                  active: row.active,
                  pinned: row.pinned,
                  preset_id: row.presetId,
                  icon_id: row.iconId,
                  type: row.type,
                  label: row.label,
                  icon: row.icon,
                  is_default: row.isDefault,
                }
              : null,
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
        await db.getRepository(CategoryEntity).update(
          { id },
          {
            label:
              v.label === undefined ? r.label : text(v.label, '分类名称', 40),
            icon,
            iconId:
              v.iconId === undefined
                ? r.icon_id
                : await validateCategoryIcon(db, book, actor.user.id, v.iconId),
            active:
              v.active === undefined
                ? Boolean(r.active)
                : booleanValue(v.active, 'active'),
            pinned:
              v.pinned === undefined
                ? Boolean(r.pinned)
                : booleanValue(v.pinned, 'pinned'),
            sortOrder:
              v.sortOrder === undefined
                ? r.sort_order
                : integer(v.sortOrder, '排序', 0, 100000),
          },
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
        const r = await db
          .getRepository(CategoryEntity)
          .findOne({
            select: {
              id: true,
              ledgerId: true,
              sortOrder: true,
              active: true,
              pinned: true,
              presetId: true,
              iconId: true,
              type: true,
              label: true,
              icon: true,
              isDefault: true,
            },
            where: { ledgerId: book, id },
          })
          .then((row) =>
            row
              ? {
                  id: row.id,
                  ledger_id: row.ledgerId,
                  sort_order: row.sortOrder,
                  active: row.active,
                  pinned: row.pinned,
                  preset_id: row.presetId,
                  icon_id: row.iconId,
                  type: row.type,
                  label: row.label,
                  icon: row.icon,
                  is_default: row.isDefault,
                }
              : null,
          )
        if (!r) {
          notFound()
        }
        this.custom(r)
        // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
        const [count] = await db.query(
          'SELECT (SELECT COUNT(*) FROM bills WHERE ledger_id=? AND category=?)+(SELECT COUNT(*) FROM ledger_events WHERE ledger_id=? AND category_id=?) AS n',
          [book, id, book, id],
        )
        if (Number(count.n)) {
          invalid('category', '此分类存在历史记录，请停用或合并，不能删除')
        }
        // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
        const [refs] = await db.query(
          'SELECT (SELECT COUNT(*) FROM ledger_budgets WHERE ledger_id=? AND category_id=?)+(SELECT COUNT(*) FROM ledger_templates WHERE ledger_id=? AND JSON_UNQUOTE(JSON_EXTRACT(bill_json,\'$.category\'))=?)+(SELECT COUNT(*) FROM ledger_rules WHERE ledger_id=? AND JSON_UNQUOTE(JSON_EXTRACT(bill_json,\'$.category\'))=?) AS n',
          [book, id, book, id, book, id],
        )
        if (Number(refs.n)) {
          invalid('category', '此分类已用于预算、模板或周期规则，请先调整')
        }
        await db.getRepository(CategoryEntity).delete({ id })
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
        const rows = await db
          .getRepository(CategoryEntity)
          .find({
            select: {
              id: true,
              ledgerId: true,
              sortOrder: true,
              active: true,
              pinned: true,
              presetId: true,
              iconId: true,
              type: true,
              label: true,
              icon: true,
              isDefault: true,
            },
            where: { ledgerId: book, id: In([id, target]) },
          })
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              ledger_id: row.ledgerId,
              sort_order: row.sortOrder,
              active: row.active,
              pinned: row.pinned,
              preset_id: row.presetId,
              icon_id: row.iconId,
              type: row.type,
              label: row.label,
              icon: row.icon,
              is_default: row.isDefault,
            })),
          )
        const sourceCategory = rows.find((row) => row.id === id)
        const t = rows.find((row) => row.id === target)
        if (!sourceCategory || !t || sourceCategory.type !== t.type) {
          invalid('targetId', '只能合并同一账本同一收支类型的分类')
        }
        this.custom(sourceCategory)
        if (!Number(t.active)) {
          invalid('targetId', '目标分类已停用')
        }
        await db
          .getRepository(BillEntity)
          .update({ ledgerId: book, category: id }, { category: target })
        await db
          .getRepository(LedgerEventEntity)
          .update({ ledgerId: book, categoryId: id }, { categoryId: target })
        const budgets = await db.getRepository(LedgerBudgetEntity).find({
          select: {
            id: true,
            ledger_id: true,
            budget_month: true,
            category_id: true,
            amount: true,
            created_by: true,
            created_at: true,
          },
          where: { ledger_id: book, category_id: id },
        })
        for (const b of budgets) {
          const targetBudget = await db
            .getRepository(LedgerBudgetEntity)
            .findOne({
              select: { id: true },
              where: {
                ledger_id: book,
                category_id: target,
                budget_month: b.budget_month,
              },
            })
          if (targetBudget) {
            await db
              .createQueryBuilder()
              .update('ledger_budgets')
              .set({ amount: () => 'amount+:p0' })
              .updateEntity(false)
              .where('id=:p1')
              .setParameters({ p0: b.amount, p1: targetBudget.id })
              .execute()
            await db.getRepository(LedgerBudgetEntity).delete({ id: b.id })
          } else {
            await db
              .getRepository(LedgerBudgetEntity)
              .update({ id: b.id }, { category_id: target })
          }
        }
        for (const table of ['ledger_templates', 'ledger_rules']) {
          await db
            .createQueryBuilder()
            .update(`${table}`)
            .set({ bill_json: () => 'JSON_SET(bill_json,\'$.category\',:p0)' })
            .updateEntity(false)
            .where(
              'ledger_id=:p1 AND JSON_UNQUOTE(JSON_EXTRACT(bill_json,\'$.category\'))=:p2',
            )
            .setParameters({ p0: target, p1: book, p2: id })
            .execute()
        }
        const recents = await db
          .getRepository(LedgerCategoryRecentEntity)
          .find({
            select: { user_id: true, last_used_at: true, created_by: true },
            where: { ledger_id: book, category_id: id },
          })
        for (const r of recents) {
          // native-sql: atomic counter, cooldown or permission merge; preserve existing-row expressions
          await db.query(
            'INSERT INTO ledger_category_recents(id,ledger_id,user_id,category_id,last_used_at,created_by) VALUES(UUID(),?,?,?,?,?) ON DUPLICATE KEY UPDATE last_used_at=GREATEST(last_used_at,VALUES(last_used_at))',
            [book, r.user_id, target, r.last_used_at, r.created_by],
          )
        }
        await db
          .getRepository(LedgerCategoryRecentEntity)
          .delete({ ledger_id: book, category_id: id })
        await db.getRepository(CategoryEntity).update({ id }, { active: false })
        await rebuild(db, book)
        return { id, targetId: target }
      },
    )
  }

  async recent(actor: Principal, book: string) {
    await this.read(actor, book)
    return this.db
      .getRepository(LedgerCategoryRecentEntity)
      .find({
        select: { category_id: true },
        where: { ledger_id: book, user_id: actor.user.id },
        order: { last_used_at: 'DESC' },
        take: 12,
      })
      .then((rows) => rows.map((row) => ({ categoryId: row.category_id })))
  }
}
