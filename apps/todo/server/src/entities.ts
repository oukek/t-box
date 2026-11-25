import type { Item } from '@t-box/todo-contracts'
import { EntitySchema } from 'typeorm'

export const Owner = new EntitySchema<{
  subject: string
  generation: number
  active: boolean
  releaseId: string
  version: number
}>({
  name: 'TodoOwner',
  tableName: 'todo_owners',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    generation: { type: 'int' },
    active: { type: 'boolean' },
    releaseId: { type: 'varchar', length: 80 },
    version: { type: 'int', default: 0 },
  },
})
export const Entry = new EntitySchema<{
  subject: string
  id: string
  revision: number
  created: string
  item: Item
}>({
  name: 'TodoEntry',
  tableName: 'todo_entries',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    id: { type: 'varchar', length: 48, primary: true },
    revision: { type: 'int' },
    created: { type: 'varchar', length: 24 },
    item: { type: 'json' },
  },
})
export const Receipt = new EntitySchema<{
  subject: string
  key: string
  hash: string
  response: Record<string, unknown>
}>({
  name: 'TodoReceipt',
  tableName: 'todo_receipts',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    key: { type: 'char', length: 64, primary: true },
    hash: { type: 'char', length: 64 },
    response: { type: 'json' },
  },
})
export const todoEntities = [Owner, Entry, Receipt]
