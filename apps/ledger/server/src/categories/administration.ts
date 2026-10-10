import type { CategoryPreset } from '@t-box/ledger-contracts'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { ApiError, invalid } from '@t-box/server-foundation/errors'
import { object, text } from '@t-box/server-foundation/input'
import { integer } from '../features/base.js'
import { parseId } from '../validation.js'

const projection =
  'id,type,label,icon,active,sort_order AS sortOrder,revision,updated_at AS updatedAt'
export class CategoryPresetAdministration {
  constructor(private readonly source: DataSource) {}
  async list(): Promise<CategoryPreset[]> {
    const rows = await this.source.query(
      `SELECT ${projection} FROM ledger_category_presets ORDER BY type,sort_order,label,id`,
    )
    return rows.map((r: any) => ({
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
    if (typeof v.active !== 'boolean') {
      invalid('active', '请选择启用状态')
    }
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
      await db.query(
        'SELECT id FROM ledger_category_catalog WHERE id=1 FOR UPDATE',
      )
      const [before] = await db.query(
        'SELECT * FROM ledger_category_presets WHERE id=?',
        [id],
      )
      if (presetId && !before) {
        throw new ApiError(404, 'PRESET_NOT_FOUND', '系统分类不存在')
      }
      if (before && Number(before.revision) !== revision) {
        throw new ApiError(
          409,
          'PRESET_REVISION_CONFLICT',
          '分类已被其他管理员修改，请刷新后重试',
        )
      }
      const type = before?.type ?? v.type
      const [duplicate] = await db.query(
        'SELECT id FROM ledger_category_presets WHERE type=? AND label=? AND id<>?',
        [type, label, id],
      )
      if (duplicate) {
        throw new ApiError(
          409,
          'PRESET_LABEL_CONFLICT',
          '同一收支类型已存在此系统分类名称',
        )
      }
      const books = await db.query(
        'SELECT id FROM ledgers ORDER BY id FOR UPDATE',
      )
      if (before) {
        await db.query(
          'UPDATE ledger_category_presets SET label=?,icon=?,active=?,sort_order=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
          [label, icon, v.active, sortOrder, id],
        )
        await db.query(
          'UPDATE bill_categories SET label=?,icon=?,active=?,sort_order=?,pinned=FALSE WHERE preset_id=?',
          [label, icon, v.active, sortOrder, id],
        )
      } else {
        await db.query(
          'INSERT INTO ledger_category_presets(id,type,label,icon,active,sort_order) VALUES(?,?,?,?,?,?)',
          [id, type, label, icon, v.active, sortOrder],
        )
        for (const book of books) {
          await db.query(
            'INSERT INTO bill_categories(id,ledger_id,type,label,icon,active,sort_order,is_default,preset_id) VALUES(?,?,?,?,?,?,?,TRUE,?)',
            [randomUUID(), book.id, type, label, icon, v.active, sortOrder, id],
          )
        }
      }
      await db.query(
        'UPDATE ledgers SET revision=revision+1 WHERE id IN (SELECT ledger_id FROM bill_categories WHERE preset_id=?)',
        [id],
      )
      await db.query(
        'UPDATE ledger_category_catalog SET revision=revision+1 WHERE id=1',
      )
      const [after] = await db.query(
        'SELECT * FROM ledger_category_presets WHERE id=?',
        [id],
      )
      await db.query(
        'INSERT INTO ledger_category_preset_audit(id,preset_id,administrator_id,before_json,after_json) VALUES(?,?,?,?,?)',
        [
          randomUUID(),
          id,
          administratorId,
          before ? JSON.stringify(before) : null,
          JSON.stringify(after),
        ],
      )
    })
    return (await this.list()).find((r) => r.id === id)!
  }
}
