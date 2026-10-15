const parse = (version: string) => {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    return null
  }
  const parts = version.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i]! < b[i]! ? -1 : 1
    }
  }
  return 0
}
/** Installation status and bundled code compatibility are separate checks. */
export function shellVersionCompatible(installed: string, bundled: string, minimum?: string) {
  if (installed === bundled) {
    return true
  }
  if (!minimum) {
    return false
  }
  const old = parse(installed)
  const host = parse(bundled)
  const lower = parse(minimum)
  return !!(old && host && lower && compare(lower, old) <= 0 && compare(old, host) <= 0)
}
