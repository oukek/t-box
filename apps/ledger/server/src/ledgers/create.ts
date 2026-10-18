import type { LedgerInput } from '@t-box/ledger-contracts'
import type { EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { LedgerEntity, LedgerMemberEntity } from '../domain-entities.js'
import { CategoryEntity } from '../entities.js'
import {
  LedgerCategoryCatalogEntity,
  LedgerCategoryPresetEntity,
} from '../persistence/categories-entities.js'

export async function createLedgerRows(
  db: EntityManager,
  userId: string,
  input: LedgerInput,
  passwordHash: string | null = null,
) {
  await db.getRepository(LedgerCategoryCatalogEntity).find({
    select: { id: true },
    where: { id: 1 },
    lock: { mode: 'pessimistic_write' },
  })
  const categories = await db.getRepository(LedgerCategoryPresetEntity).find({
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
    order: { sort_order: 'ASC', id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  })
  const id = randomUUID()
  await db.getRepository(LedgerEntity).insert({
    id,
    name: input.name,
    template: input.template,
    ownerId: userId,
    passwordHash,
  })
  await db
    .getRepository(LedgerMemberEntity)
    .insert({ ledgerId: id, userId, role: 'owner' })
  for (const category of categories) {
    await db.getRepository(CategoryEntity).insert({
      id: randomUUID(),
      ledgerId: id,
      type: category.type,
      label: category.label,
      icon: category.icon,
      isDefault: true,
      sortOrder: category.sort_order,
      active: Boolean(Number(category.active)),
      presetId: category.id,
    })
  }
  return id
}
