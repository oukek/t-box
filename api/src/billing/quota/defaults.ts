import type { QuotaTariff, ResourcePackageDraft } from '@t-box/shared'

export const initialTariff: QuotaTariff = {
  version: 1,
  enabled: false,
  inputPerMillion: '250',
  outputPerMillion: '1000',
  cachedInputPerMillion: '250',
  images: { '1k': '10', '2k': '20', '4k': '30' },
  edits: { '1k': '10', '2k': '20', '4k': '30' },
  taskLimit: '90',
  imageLimit: 3,
  publishedAt: '2026-10-22T00:00:00.000Z',
}
export const initialPackages: ResourcePackageDraft[] = [
  ['light', '轻量算力包', '9.90', '500'],
  ['basic', '基础算力包', '21.90', '1200'],
  ['standard', '标准算力包', '34.90', '2000'],
  ['advance', '进阶算力包', '49.90', '3000'],
  ['pro', '专业算力包', '79.90', '5000'],
  ['heavy', '重度算力包', '219.00', '15000'],
  ['enterprise', '企业算力包', '429.00', '30000'],
  ['flagship', '旗舰算力包', '699.00', '50000'],
].map(([code, name, price, quota], sort) => ({
  code: code!,
  name: name!,
  price: price!,
  quota: quota!,
  bonusQuota: '0',
  validDays: 180,
  description: '用于 AI 对话与图片处理，不可提现或转让。',
  sort,
  enabled: true,
}))
