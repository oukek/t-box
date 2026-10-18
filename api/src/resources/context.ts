import type { ProviderItem } from '../chat/provider.js'
import { ErrorCode } from '../error-codes.js'
/**
 * Restore internal resource references after the provider returns retained user items.
 * Large base64/file bytes are request projections, never durable context or credentials.
 */
export function restoreContextReferences(
  original: ProviderItem[],
  prepared: ProviderItem[],
  compacted: ProviderItem[],
): ProviderItem[] {
  const replacements = new Map<string, unknown>()
  for (const [index, item] of original.entries()) {
    const projected = prepared[index]
    if (
      !('content' in item) ||
      !Array.isArray(item.content) ||
      !projected ||
      !('content' in projected) ||
      !Array.isArray(projected.content)
    ) {
      continue
    }
    for (const [partIndex, part] of item.content.entries()) {
      const projection = projected.content[partIndex]
      if (
        projection &&
        ((part.type === 'input_image' &&
          part.image_url?.startsWith('asset:')) ||
          (part.type === 'input_text' && part.text.startsWith('asset-text:')))
      ) {
        replacements.set(JSON.stringify(projection), part)
      }
    }
  }
  return compacted.map((item) => {
    if (!('content' in item) || !Array.isArray(item.content)) {
      return item
    }
    const content = item.content.map((part) => {
      const replacement = replacements.get(JSON.stringify(part))
      if (replacement) {
        return structuredClone(replacement)
      }
      if (part.type === 'input_image' && part.image_url?.startsWith('data:')) {
        throw ErrorCode.COMPACTION_ATTACHMENT_INVALID()
      }
      return part
    })
    return { ...item, content } as ProviderItem
  })
}
