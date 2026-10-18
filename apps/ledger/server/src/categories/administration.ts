import type { CategoryPreset } from '@t-box/ledger-contracts'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import {
  booleanValue,
  choice,
  object,
  text,
} from '@t-box/server-foundation/input'
import { Not } from 'typeorm'
import { LedgerEntity } from '../domain-entities.js'
import { CategoryEntity } from '../entities.js'
import { ErrorCode } from '../error-codes.js'
import { integer } from '../features/base.js'
import {
  LedgerCategoryCatalogEntity,
  LedgerCategoryPresetAuditEntity,
  LedgerCategoryPresetEntity,
} from '../persistence/categories-entities.js'
import { parseId } from '../validation.js'

export class CategoryPresetAdministration {
  constructor(private readonly source: DataSource) {}
  async list(): Promise<CategoryPreset[]> {
    const rows = await this.source
      .getRepository(LedgerCategoryPresetEntity)
      .find({
        select: {
          id: true,
          type: true,
          label: true,
          icon: true,
          active: true,
          sort_order: true,
          revision: true,
          updated_at: true,
        },
        order: { type: 'ASC', sort_order: 'ASC', label: 'ASC', id: 'ASC' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          type: row.type,
          label: row.label,
          icon: row.icon,
          active: row.active,
          sortOrder: row.sort_order,
          revision: row.revision,
          updatedAt: row.updated_at,
        })),
      )
    return rows.map((r) => ({
      ...r,
      active: Boolean(r.active),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }))
  }

  async save(value: unknown, administratorId: string, presetId?: string) {
    const v = object(
      value,
      presetId
        ? ['label', 'icon', 'active', 'sortOrder', 'revision']
        : ['type', 'label', 'icon', 'active', 'sortOrder'],
    )
    const label = text(v.label, '分类名称', 40)
    const icon = text(v.icon, '图标', 32)
    const active = booleanValue(v.active, 'active')
    const sortOrder = integer(v.sortOrder, '排序', 0, 100000)
    const revision = presetId
      ? integer(v.revision, '版本', 1, 2147483647)
      : null
    if (!presetId && v.type !== 'income' && v.type !== 'expense') {
      invalid('type', '请选择收入或支出')
    }
    const id = presetId ? parseId(presetId) : randomUUID()
    await this.source.transaction(async (db) => {
      // Shared lock order with book creation: catalog first, then books. No partial fan-out.
      await db.getRepository(LedgerCategoryCatalogEntity).find({
        select: { id: true },
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      })
      const before = await db
        .getRepository(LedgerCategoryPresetEntity)
        .findOne({
          select: {
            id: true,
            type: true,
            label: true,
            icon: true,
            active: true,
            sort_order: true,
            revision: true,
            updated_at: true,
          },
          where: { id },
        })
      if (presetId && !before) {
        throw ErrorCode.PRESET_NOT_FOUND()
      }
      if (before && Number(before.revision) !== revision) {
        throw ErrorCode.PRESET_REVISION_CONFLICT()
      }
      const type = before?.type ?? choice(v.type, 'type', ['income', 'expense'])
      const duplicate = await db
        .getRepository(LedgerCategoryPresetEntity)
        .findOne({
          select: { id: true },
          where: { type, label, id: Not(id) },
        })
      if (duplicate) {
        throw ErrorCode.PRESET_LABEL_CONFLICT()
      }
      const books = await db
        .getRepository(LedgerEntity)
        .find({
          select: { id: true },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        })
        .then((rows) => rows.map((row) => ({ id: row.id })))
      if (before) {
        await db.getRepository(LedgerCategoryPresetEntity).update(
          { id },
          {
            label,
            icon,
            active,
            sort_order: sortOrder,
            revision: () => 'revision+1',
            updated_at: () => 'UTC_TIMESTAMP(3)',
          },
        )
        await db.getRepository(CategoryEntity).update(
          { presetId: id },
          {
            label,
            icon,
            active,
            sortOrder,
            pinned: false,
          },
        )
      } else {
        await db.getRepository(LedgerCategoryPresetEntity).insert({
          id,
          type,
          label,
          icon,
          active,
          sort_order: sortOrder,
        })
        for (const book of books) {
          await db.getRepository(CategoryEntity).insert({
            id: randomUUID(),
            ledgerId: book.id,
            type,
            label,
            icon,
            active,
            sortOrder,
            isDefault: true,
            presetId: id,
          })
        }
      }
      // native-sql: atomic correlated update fenced against concurrent task/category changes
      await db.query(
        'UPDATE ledgers SET revision=revision+1 WHERE id IN (SELECT ledger_id FROM bill_categories WHERE preset_id=?)',
        [id],
      )
      await db
        .getRepository(LedgerCategoryCatalogEntity)
        .update({ id: 1 }, { revision: () => 'revision+1' })
      const after = await db.getRepository(LedgerCategoryPresetEntity).findOne({
        select: {
          id: true,
          type: true,
          label: true,
          icon: true,
          active: true,
          sort_order: true,
          revision: true,
          updated_at: true,
        },
        where: { id },
      })
      await db.getRepository(LedgerCategoryPresetAuditEntity).insert({
        id: randomUUID(),
        preset_id: id,
        administrator_id: administratorId,
        before_json: before || null,
        after_json: after,
      })
    })
    return (await this.list()).find((r) => r.id === id)!
  }
}
