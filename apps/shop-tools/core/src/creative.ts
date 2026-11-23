import type { CreativeInput, CreativeRules, CreativeTemplate } from '@t-box/shop-tools-contracts'
import { ShopError } from '@t-box/shop-tools-contracts'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ShopError.invalid('创作数据格式无效')
  }
  return value as Record<string, unknown>
}
function field(value: unknown, limit: number) {
  if (typeof value !== 'string' || value.length > limit) {
    throw ShopError.invalid('创作字段缺失或过长')
  }
  return value.trim()
}
function rules(value: unknown): CreativeRules {
  const r = record(value)
  return { title: field(r.title, 1000), description: field(r.description, 1000), image: field(r.image, 1000), language: field(r.language, 50) }
}
export function parseTemplates(value: unknown): CreativeTemplate[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw ShopError.invalid('项目最多保存 50 个模板')
  }
  const ids = new Set<string>()
  return value.map((entry) => {
    const t = record(entry)
    const id = field(t.id, 80)
    const name = field(t.name, 80)
    if (!id || !name || ids.has(id)) {
      throw ShopError.invalid('请填写模板名称并检查模板编号')
    }
    ids.add(id)
    return { id, name, ...rules(t) }
  })
}
export function parseCreativeInput(value: unknown): CreativeInput {
  const v = record(value)
  const title = field(v.title, 1000)
  const description = field(v.description, 12000)
  const imageId = field(v.imageId, 80)
  if (!title && !description && !imageId) {
    throw ShopError.invalid('请提供原始标题、描述或商品图片')
  }
  const fields = v.fields
  if (!Array.isArray(fields) || !fields.length || fields.length > 3 || new Set(fields).size !== fields.length ||
    fields.some((f) => !['title', 'description', 'image'].includes(f))) {
    throw ShopError.invalid('请选择要优化的内容')
  }
  if (fields.includes('image') && !imageId) {
    throw ShopError.invalid('优化图片需要上传原图')
  }
  return { title, description, imageId, fields: [...fields], rules: rules(v.rules) }
}
