import type { CategoryInput } from '@t-box/ledger-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { parseId } from '../validation.js'

export function parseCategoryInput(value: unknown): CategoryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('body', '必须是 JSON 对象')
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).some(
      (key) => !['label', 'type', 'icon', 'iconId'].includes(key),
    )
  ) {
    invalid('body', '不支持的字段')
  }
  if (input.type !== 'income' && input.type !== 'expense') {
    invalid('type', '请选择收入或支出')
  }
  if (
    typeof input.label !== 'string' ||
    !input.label.trim() ||
    input.label.trim().length > 40
  ) {
    invalid('label', '分类名称须为 1–40 个字符')
  }
  if (
    input.icon !== undefined &&
    (typeof input.icon !== 'string' ||
      !/^[a-z][a-zA-Z]{0,31}$/.test(input.icon))
  ) {
    invalid('icon', '图标标识无效')
  }
  return {
    ...(input.iconId === undefined
      ? {}
      : { iconId: input.iconId === null ? null : parseId(input.iconId) }),
    type: input.type,
    label: input.label.trim(),
    ...(input.icon === undefined ? {} : { icon: input.icon as string }),
  }
}
