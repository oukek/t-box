import type { ImageTier } from '@t-box/shared'
import { IMAGE_TIERS } from '@t-box/shared'
import { prices } from '../billing/money.js'
import { ErrorCode } from '../error-codes.js'

export function imageTier(value: unknown): ImageTier {
  const tier = value ?? '1k'
  if (tier !== '1k' && tier !== '2k' && tier !== '4k') {
    throw ErrorCode.IMAGE_TIER_INVALID()
  }
  return tier
}

export function imageModelTiers(value: unknown): ImageTier[] {
  if (value === undefined) {
    return ['1k']
  }
  if (!Array.isArray(value) || !value.length || value.length > 3 ||
    value.some((tier) => !IMAGE_TIERS.includes(tier)) || new Set(value).size !== value.length) {
    throw ErrorCode.IMAGE_TIER_INVALID('请至少选择一个图片分辨率档位，且只能选择不重复的 1K、2K、4K')
  }
  return IMAGE_TIERS.filter((tier) => value.includes(tier))
}

export function imageModelPrices(value: unknown, tiers: ImageTier[]): Partial<Record<ImageTier, string>> {
  if (value === undefined || value === null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !IMAGE_TIERS.includes(key as ImageTier))) {
    throw ErrorCode.INVALID_CONFIG('图片档位报价格式无效')
  }
  const overrides = value as Record<string, unknown>
  const result: Partial<Record<ImageTier, string>> = {}
  for (const tier of tiers) {
    const price = overrides[tier]
    if (price === undefined || price === null || price === '') {
      continue
    }
    if (typeof price !== 'string') {
      throw ErrorCode.INVALID_CONFIG('图片档位报价应为非负金额字符串')
    }
    result[tier] = prices({ imagePrice: price }).imagePrice
  }
  return result
}

/** Raw JSON columns can be returned as text by MySQL drivers or as parsed objects. */
function storedJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    throw ErrorCode.INVALID_CONFIG('图片模型配置无法读取，请重新保存模型配置')
  }
}
export const storedImageTiers = (value: unknown) => imageModelTiers(storedJson(value))
export const storedImagePrices = (value: unknown, tiers: ImageTier[]) => imageModelPrices(storedJson(value), tiers)

/** Never let an upstream automatic size silently upgrade a default 1K request. */
export function imageRequestSize(tier: ImageTier, oneKSize = '1024x1024') {
  if (tier === '4k') {
    return '4096x4096'
  }
  if (tier === '2k') {
    return '2048x2048'
  }
  return oneKSize === '1024x1536' || oneKSize === '1536x1024'
    ? oneKSize
    : '1024x1024'
}
