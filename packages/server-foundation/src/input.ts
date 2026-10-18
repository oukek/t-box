import { invalid } from './errors.js'

export function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('body', '必须是 JSON 对象')
  }
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) {
    if (!fields.includes(key)) {
      invalid(key, '不支持的字段')
    }
  }
  return result
}
export function text(value: unknown, label: string, max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    invalid(label, `${label}须为 1–${max} 个字符`)
  }
  return value.trim()
}

export function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    invalid(field, '请选择有效状态')
  }
  return value
}

export function choice<const T extends readonly string[]>(
  value: unknown,
  field: string,
  options: T,
): T[number] {
  if (typeof value !== 'string' || !options.includes(value)) {
    invalid(field, '请选择有效类型')
  }
  return value as T[number]
}
