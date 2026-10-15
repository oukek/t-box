/** Portable version-owned image, independent of artifact origin or host public paths. */
export const APPLICATION_ICON_MAX_BYTES = 128 * 1024
export function validApplicationIcon(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > APPLICATION_ICON_MAX_BYTES * 1.4) {
    return false
  }
  const match = /^data:image\/(svg\+xml|png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) {
    return false
  }
  try {
    const data = atob(match[2]!)
    if (!data.length || data.length > APPLICATION_ICON_MAX_BYTES || btoa(data) !== match[2]) {
      return false
    }
    if (match[1] === 'svg+xml') {
      return /^\s*<svg\s/i.test(data) && /<\/svg>\s*$/.test(data) &&
        !/<\s*(?:script|foreignObject|iframe|image|use|style|animate\w*|set)\b|<!|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\((?!#[\w-]+\))/i.test(data)
    }
    if (match[1] === 'png') {
      return data.startsWith('\x89PNG\r\n\x1A\n')
    }
    if (match[1] === 'jpeg') {
      return data.startsWith('\xFF\xD8\xFF')
    }
    if (match[1] === 'gif') {
      return /^GIF8[79]a/.test(data)
    }
    return data.startsWith('RIFF') && data.slice(8, 12) === 'WEBP'
  } catch {
    return false
  }
}
