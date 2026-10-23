import { hostBrand } from './brand.js'

/** Host distribution links, separate from the market for installed mini apps. */
export interface HostDownloadSettings {
  displayName: string
  iosAppStoreUrl: string
  androidDownloadUrl: string
}

export const defaultHostDownloads: Readonly<HostDownloadSettings> = Object.freeze({ displayName: `${hostBrand.name}（${hostBrand.englishName}）`, iosAppStoreUrl: '', androidDownloadUrl: '' })

export function parseHostDownloads(value: unknown): HostDownloadSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['displayName', 'iosAppStoreUrl', 'androidDownloadUrl'].includes(key)) || typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 40) {
    return null
  }
  const output = { displayName: input.displayName.trim(), iosAppStoreUrl: '', androidDownloadUrl: '' }
  for (const key of ['iosAppStoreUrl', 'androidDownloadUrl'] as const) {
    if (typeof input[key] !== 'string' || input[key].length > 2048) {
      return null
    }
    const text = input[key].trim()
    if (!text) {
      continue
    }
    try {
      const url = new URL(text)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || (key === 'iosAppStoreUrl' && (url.hostname !== 'apps.apple.com' || !/\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/i.test(url.pathname)))) {
        return null
      }
      output[key] = url.href
    } catch {
      return null
    }
  }
  return output
}
