import { jsonValue } from './queries.js'

export interface AuditMessage {
  id: string
  role: string
  content: string
  attachments: { id: string, name: string, mimeType: string }[]
  error: unknown
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function message(value: unknown): AuditMessage | null {
  const row = record(value)
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.role !== 'string' ||
    typeof row.content !== 'string'
  ) {
    return null
  }
  const attachments: AuditMessage['attachments'] = []
  if (Array.isArray(row.attachments)) {
    for (const value of row.attachments) {
      const item = record(value)
      if (
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.mimeType === 'string'
      ) {
        attachments.push({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
        })
      }
    }
  }
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments,
    error: row.error,
  }
}
/** Only explicitly permitted display fields cross this boundary; never expose a checkpoint. */
export function auditCheckpoint(value: unknown) {
  const checkpoint = record(jsonValue(value))
  const session = record(checkpoint?.session)
  const messages = Array.isArray(session?.messages)
    ? session.messages
        .map((value: unknown) => message(value))
        .filter((value): value is AuditMessage => value !== null)
    : []
  return {
    assistantId:
      typeof checkpoint?.assistantId === 'string'
        ? checkpoint.assistantId
        : undefined,
    auditResult: message(checkpoint?.auditResult),
    messages,
  }
}
