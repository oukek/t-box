import { ErrorCode } from './error-codes.ts'

const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSystemVersion(value: unknown): [bigint, bigint, bigint] {
  const parts = typeof value === 'string' && releasePattern.exec(value)
  if (!parts) {
    throw ErrorCode.INVALID_SYSTEM_VERSION()
  }
  return [BigInt(parts[1]!), BigInt(parts[2]!), BigInt(parts[3]!)]
}

export function compareSystemVersions(left: string, right: string): number {
  const a = parseSystemVersion(left)
  const b = parseSystemVersion(right)
  for (const i of [0, 1, 2] as const) {
    if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1
    }
  }
  return 0
}

export function nextSystemVersion(current: string, change: 'major' | 'minor' | 'patch' | 'manual', manual?: string): string {
  if (change === 'manual') {
    if (!manual || compareSystemVersions(manual, current) <= 0) {
      throw ErrorCode.INVALID_SYSTEM_VERSION_ORDER()
    }
    return manual
  }
  const [major, minor, patch] = parseSystemVersion(current)
  switch (change) {
    case 'major': return [major + 1n, 0, 0].join('.')
    case 'minor': return [major, minor + 1n, 0].join('.')
    case 'patch': return [major, minor, patch + 1n].join('.')
    default: throw ErrorCode.INVALID_SYSTEM_VERSION_CHANGE()
  }
}
