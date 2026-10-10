import type { LedgerInput } from '@t-box/ledger-contracts'
import type { EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'

export async function createLedgerRows(
  db: EntityManager,
  userId: string,
  input: LedgerInput,
  passwordHash: string | null = null,
) {
  await db.query(
    'SELECT id FROM ledger_category_catalog WHERE id=1 FOR UPDATE',
  )
  const categories = await db.query(
    'SELECT * FROM ledger_category_presets ORDER BY sort_order,id FOR UPDATE',
  )
  const id = randomUUID()
  await db.query(
    'INSERT INTO ledgers(id,name,template,owner_id,password_hash) VALUES(?,?,?,?,?)',
    [id, input.name, input.template, userId, passwordHash],
  )
  await db.query(
    'INSERT INTO ledger_members(ledger_id,user_id,role) VALUES(?,?,\'owner\')',
    [id, userId],
  )
  for (const category of categories) {
    await db.query(
      'INSERT INTO bill_categories(id,ledger_id,type,label,icon,is_default,sort_order,active,preset_id) VALUES(?,?,?,?,?,TRUE,?,?,?)',
      [
        randomUUID(),
        id,
        category.type,
        category.label,
        category.icon,
        category.sort_order,
        category.active,
        category.id,
      ],
    )
  }
  return id
}
