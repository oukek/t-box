import type { CatalogContent, CatalogMedia, OptimizationJob, OptimizationMode, OptimizationSlot, ProjectPrompt } from '@t-box/shop-tools-contracts'
import { ShopError } from '@t-box/shop-tools-contracts'

export function projectPrompt(value: unknown, revision = 0): ProjectPrompt {
  const v = value as ProjectPrompt
  if (!v || typeof v.language !== 'string' || !v.language.trim() || v.language.length > 50 || typeof v.prompt !== 'string' || v.prompt.length > 8000) {
    throw ShopError.invalid('目标语言或项目要求无效')
  }
  return { language: v.language.trim(), prompt: v.prompt.trim(), revision }
}
export function catalogMedia(content: CatalogContent): CatalogMedia[] {
  const result: CatalogMedia[] = []
  const reserved = new Set(content.media?.map((a) => a.id))
  const assigned = new Set<string>()
  for (const group of [{ id: null, images: content.images }, ...content.skus.map((s) => ({ id: s.id, images: s.images || [] }))]) {
    const used = new Set<string>()
    group.images.forEach((url, position) => {
      const old = content.media?.find((a) => a.skuId === group.id && a.url === url && !used.has(a.id))
      if (old && !assigned.has(old.id)) {
        used.add(old.id)
        assigned.add(old.id)
        result.push({ ...old, position })
        return
      }
      const prefix = `image:${group.id || 'product'}:${position}`
      let id = prefix
      let suffix = 0
      while (reserved.has(id) || assigned.has(id)) {
        id = prefix + ':' + (++suffix)
      }
      assigned.add(id)
      result.push({ id, skuId: group.id, position, url })
    })
  }
  if (content.imageFileId && !result.some((a) => a.fileId === content.imageFileId)) {
    result.unshift({ id: 'image:legacy-ai', skuId: null, position: -1, url: '', fileId: content.imageFileId })
  }
  return result
}
export function optimizationSlots(content: CatalogContent): OptimizationSlot[] {
  return [
    { id: 'title', kind: 'text', label: '商品标题', skuId: null, position: 0, text: content.title, mode: 'optimize' },
    { id: 'description', kind: 'text', label: '商品描述', skuId: null, position: 1, text: content.description, mode: 'optimize' },
    ...content.skus.map((s, position) => ({ id: `sku:${s.id}`, kind: 'text' as const, label: s.name, skuId: s.id, position, text: s.name, mode: 'optimize' as const })),
    ...catalogMedia(content).map((asset) => ({ id: asset.id, kind: 'image' as const, label: asset.skuId ? `${content.skus.find((s) => s.id === asset.skuId)?.name} · 规格图 ${asset.position + 1}` : `商品图 ${asset.position + 1}`, skuId: asset.skuId, position: asset.position, asset, mode: 'optimize' as const })),
  ]
}
export function selectOptimization(content: CatalogContent, value: unknown): OptimizationSlot[] {
  const choices = value as Record<string, { mode: OptimizationMode, text?: string }>
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)) {
    throw ShopError.invalid('请选择需要优化的素材')
  }
  const slots = optimizationSlots(content)
  if (Object.keys(choices).some((id) => !slots.some((s) => s.id === id))) {
    throw ShopError.invalid('商品素材已变化，请重新打开')
  }
  for (const slot of slots) {
    const choice = choices[slot.id]
    if (!choice || !['optimize', 'keep', 'remove'].includes(choice.mode)) {
      throw ShopError.invalid('素材处理方式无效')
    }
    slot.mode = choice.mode
    if (choice.text !== undefined) {
      if (slot.kind !== 'text' || typeof choice.text !== 'string' || choice.text.length > (slot.id === 'description' ? 100000 : 1000)) {
        throw ShopError.invalid('素材文字无效')
      }
      if (slot.mode === 'optimize') {
        slot.text = choice.text
      }
    }
  }
  const removed = new Set(slots.filter((s) => s.id.startsWith('sku:') && s.mode === 'remove').map((s) => s.skuId))
  for (const slot of slots) {
    if (slot.kind === 'image' && removed.has(slot.skuId)) {
      slot.mode = 'remove'
    }
  }
  if (slots[0]!.mode === 'remove' || removed.size === content.skus.length || !slots.some((s) => s.mode === 'optimize')) {
    throw ShopError.invalid('须保留标题及至少一个 SKU，并选择优化内容')
  }
  return slots
}
export function optimizationContent(job: OptimizationJob, edits: unknown = {}): CatalogContent {
  const values = edits as Record<string, string>
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some((id) => !job.snapshot.slots.some((s) => s.id === id && s.kind === 'text' && s.mode !== 'remove'))) {
    throw ShopError.invalid('结果编辑标识无效')
  }
  const content = structuredClone(job.snapshot.source)
  const removed = new Set(job.snapshot.slots.filter((s) => s.id.startsWith('sku:') && s.mode === 'remove').map((s) => s.skuId))
  content.skus = content.skus.filter((s) => !removed.has(s.id))
  const media: CatalogMedia[] = []
  for (const slot of job.snapshot.slots) {
    const result = job.results[slot.id]
    if (slot.mode === 'optimize' && result?.status !== 'complete') {
      throw ShopError.invalid('请先重试失败项，全部完成后再创建版本')
    }
    if (slot.kind === 'image') {
      if (slot.mode !== 'remove') {
        media.push({ ...slot.asset!, ...(slot.mode === 'optimize' ? { fileId: result!.fileId } : {}) })
      }
      continue
    }
    const text = values[slot.id] ?? (slot.mode === 'remove' ? '' : slot.mode === 'keep' ? slot.text! : result!.text!)
    if (typeof text !== 'string' || text.length > (slot.id === 'description' ? 100000 : 1000) || (slot.id !== 'description' && slot.mode !== 'remove' && !text.trim())) {
      throw ShopError.invalid('优化结果文字无效')
    }
    if (slot.id === 'title') {
      content.title = text
    } else if (slot.id === 'description') {
      content.description = text
    } else {
      const sku = content.skus.find((s) => s.id === slot.skuId)
      if (sku) {
        sku.name = text
      }
    }
  }
  content.media = media
  delete content.imageFileId
  // Original URL and position remain attached to the stable media id;
  // fileId supplies the optimized image.
  content.images = media.filter((a) => !a.skuId).map((a) => a.url)
  for (const sku of content.skus) {
    sku.images = media.filter((a) => a.skuId === sku.id).map((a) => a.url)
  }
  return content
}
