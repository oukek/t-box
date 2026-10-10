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
