import type { ApplicationManifest } from '@t-box/shared'

export interface MentionQuery {
  start: number
  end: number
  query: string
}
/** Detect only explicit @ input. Email addresses are ordinary text. */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const prefix = text.slice(0, caret)
  const start = Math.max(prefix.lastIndexOf('@'), prefix.lastIndexOf('＠'))
  if (
    start < 0 ||
    (prefix[start] === '@' &&
      start > 0 &&
      /[\w.%+-]/.test(prefix[start - 1]!))
  ) {
    return null
  }
  const query = prefix.slice(start + 1)
  if (/[\s@＠]/.test(query)) {
    return null
  }
  return { start, end: caret, query }
}
export function mentionCandidates(
  query: string,
  catalog: readonly ApplicationManifest[],
) {
  const needle = query.trim().toLowerCase()
  return catalog.filter((app) =>
    `${app.id} ${app.name}`.toLowerCase().includes(needle),
  )
}
