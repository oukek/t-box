import type {
  BillCategory,
  BillInput,
  CategoryInput,
} from '@t-box/ledger-contracts'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { CategoryEntity } from '../entities.js'

export interface CategoryRepository {
  list(): Promise<BillCategory[]>
  create(input: CategoryInput): Promise<BillCategory>
  validate(input: Pick<BillInput, 'type' | 'category'>): Promise<void>
}
export function createCategoryRepository(
  source: DataSource,
): CategoryRepository {
  const repository = source.getRepository(CategoryEntity)
  return {
    list: () =>
      repository.find({ order: { type: 'ASC', isDefault: 'DESC', id: 'ASC' } }),
    async create(input) {
      const row = {
        id: randomUUID(),
        ...input,
        icon: input.icon ?? 'other',
        isDefault: false,
      }
      await repository.insert(row)
      return row
    },
    async validate(input) {
      if (
        !(await repository.existsBy({ id: input.category, type: input.type }))
      ) {
        invalid('category', '分类不存在或与收支类型不匹配')
      }
    },
  }
}
