import type { PromotionCreativeDraft, PromotionCreativeSettings, PromotionImage } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { ResourceStorageRegistry } from '../resources/storage.js'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { object } from '@t-box/server-foundation/input'
import { defaultPromotionCreative } from '@t-box/shared'
import sharp from 'sharp'
import { PlatformConfigurationEntity, PlatformConfigurationHistoryEntity, PlatformConfigurationStateEntity } from '../db/records/configuration-entities.js'
import { ErrorCode } from '../error-codes.js'
import { runtimeResourceStorage } from '../resources/runtime-storage.js'
import { PromotionAssetEntity } from './entities.js'

export const PROMOTION_CREATIVE_KEY = 'host.promotion-creatives'
export const MAX_PROMOTION_IMAGE_SIZE = 8 * 1024 * 1024
const uuid = /^[a-f0-9-]{36}$/

export function parsePromotionCreative(value: unknown): PromotionCreativeDraft {
  const input = object(value, ['revision', 'title', 'description', 'thumbnailId', 'posterId', 'qr'])
  const qr = object(input.qr, ['x', 'y', 'size'])
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0 ||
    typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 80 ||
    typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 300 ||
    ![input.thumbnailId, input.posterId].every((id) => id === null || (typeof id === 'string' && uuid.test(id))) ||
    ![qr.x, qr.y, qr.size].every((value) => typeof value === 'number' && Number.isFinite(value)) ||
    Number(qr.x) < 0 || Number(qr.y) < 0 || Number(qr.size) < 5 || Number(qr.size) > 80 ||
    Number(qr.x) + Number(qr.size) > 100 || Number(qr.y) >= 100) {
    throw ErrorCode.PROMOTION_CREATIVE_INVALID()
  }
  return {
    revision: Number(input.revision),
    title: input.title.trim(),
    description: input.description.trim(),
    thumbnailId: input.thumbnailId as string | null,
    posterId: input.posterId as string | null,
    qr: { x: Number(qr.x), y: Number(qr.y), size: Number(qr.size) },
  }
}

export function promotionQrPlacement(width: number, height: number, qr: PromotionCreativeDraft['qr']) {
  const placement = { left: Math.round(width * qr.x / 100), top: Math.round(height * qr.y / 100), width: Math.round(width * qr.size / 100) }
  if (placement.width < 128 || placement.left < 0 || placement.top < 0 ||
    placement.left + placement.width > width || placement.top + placement.width > height) {
    throw ErrorCode.PROMOTION_CREATIVE_INVALID('二维码必须完整位于邀请海报内，且边长至少 128 像素')
  }
  return placement
}

export async function normalizePromotionImage(bytes: Buffer, kind: PromotionImage['kind']) {
  try {
    if (!bytes.length || bytes.length > MAX_PROMOTION_IMAGE_SIZE) {
      throw ErrorCode.PROMOTION_IMAGE_INVALID()
    }
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false, failOn: 'error' })
    const meta = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1 ||
      !meta.width || !meta.height || Math.max(meta.width, meta.height) / Math.min(meta.width, meta.height) > 3 ||
      Math.min(meta.width, meta.height) < (kind === 'poster' ? 600 : 128)) {
      throw ErrorCode.PROMOTION_IMAGE_INVALID()
    }
    const normalized = image.rotate().flatten({ background: '#ffffff' })
    if (kind === 'thumbnail') {
      normalized.resize(300, 300, { fit: 'cover' })
    } else {
      normalized.resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    }
    return await normalized.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })
  } catch {
    throw ErrorCode.PROMOTION_IMAGE_INVALID()
  }
}

export class PromotionCreativeService {
  constructor(readonly source: DataSource, private storage?: ResourceStorageRegistry) {}

  private registry() {
    this.storage ??= runtimeResourceStorage(fileURLToPath(new URL('../../.storage/promotion-assets/', import.meta.url)))
    return this.storage
  }

  async image(id: string, kind?: PromotionImage['kind']) {
    const row = uuid.test(id) ? await this.source.getRepository(PromotionAssetEntity).findOneBy({ id, ...(kind ? { kind } : {}) }) : null
    if (!row) {
      throw ErrorCode.PROMOTION_IMAGE_NOT_FOUND()
    }
    return row
  }

  async bytes(id: string) {
    const image = await this.image(id)
    return this.registry().get(image.backend).read(image.path)
  }

  async upload(bytes: Buffer, kind: PromotionImage['kind'], administratorId: string): Promise<PromotionImage> {
    const normalized = await normalizePromotionImage(bytes, kind)
    const id = randomUUID()
    const registry = this.registry()
    const backend = registry.get(registry.activeId)
    const path = backend.path?.(id) ?? id
    await backend.write(path, normalized.data, { name: 'promotion-' + kind + '.jpg', mimeType: 'image/jpeg' })
    try {
      await this.source.getRepository(PromotionAssetEntity).insert({
        id,
        kind,
        backend: registry.activeId,
        path,
        width: normalized.info.width,
        height: normalized.info.height,
        size: normalized.data.length,
        uploadedBy: administratorId,
      })
    } catch (cause) {
      // A lost commit acknowledgement must not delete a successfully stored image.
      const committed = await this.source.getRepository(PromotionAssetEntity).existsBy({ id }).catch(() => true)
      if (!committed) {
        await backend.remove(path).catch(() => {})
      }
      throw cause
    }
    return { id, kind, width: normalized.info.width, height: normalized.info.height, url: '/promotions/assets/' + id + '.jpg' }
  }

  async resolve(value: unknown): Promise<PromotionCreativeSettings> {
    const draft = parsePromotionCreative(value)
    const thumbnail = draft.thumbnailId ? await this.image(draft.thumbnailId, 'thumbnail') : null
    const poster = draft.posterId ? await this.image(draft.posterId, 'poster') : null
    promotionQrPlacement(poster?.width ?? 1080, poster?.height ?? 1920, draft.qr)
    const dto = (row: NonNullable<typeof poster>): PromotionImage => ({ id: row.id, kind: row.kind, width: row.width, height: row.height, url: '/promotions/assets/' + row.id + '.jpg' })
    return { ...draft, thumbnail: thumbnail ? dto(thumbnail) : null, poster: poster ? dto(poster) : null }
  }

  async read(): Promise<PromotionCreativeSettings> {
    const row = await this.source.getRepository(PlatformConfigurationEntity).findOneBy({ config_key: PROMOTION_CREATIVE_KEY })
    const value = row ? typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json : defaultPromotionCreative()
    return this.resolve(value)
  }

  async save(value: unknown, administratorId: string) {
    const draft = parsePromotionCreative(value)
    await this.resolve(draft)
    await this.source.transaction(async (db) => {
      const states = db.getRepository(PlatformConfigurationStateEntity)
      const state = await states.findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } })
      if (!state) {
        throw ErrorCode.SCHEMA_REQUIRED()
      }
      const configurations = db.getRepository(PlatformConfigurationEntity)
      const old = await configurations.findOneBy({ config_key: PROMOTION_CREATIVE_KEY })
      const previous = old ? parsePromotionCreative(typeof old.value_json === 'string' ? JSON.parse(old.value_json) : old.value_json) : defaultPromotionCreative()
      if (draft.revision !== previous.revision) {
        throw ErrorCode.PROMOTION_CREATIVE_STALE()
      }
      const current = { ...draft, revision: previous.revision + 1 }
      const revision = Number(state.revision) + 1
      await configurations.save({ config_key: PROMOTION_CREATIVE_KEY, definition_json: { owner: 'host', version: 1 }, value_json: current, updated_at: new Date().toISOString() })
      await states.update({ id: 1 }, { revision })
      await db.getRepository(PlatformConfigurationHistoryEntity).insert({
        config_key: PROMOTION_CREATIVE_KEY,
        revision,
        value_json: current,
        administrator_id: administratorId,
        note: '更新分享图片、邀请海报与分享文案',
        created_at: new Date().toISOString(),
      })
    })
    return this.read()
  }
}
