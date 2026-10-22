import type { ChatMessage, MemoryKind } from '@t-box/shared'
import type { MemoryInput } from './contracts.js'
import { createHash } from 'node:crypto'
import { ErrorCode } from '../error-codes.js'

export const memoryHash = (text: string) =>
  createHash('sha256').update(text).digest('hex')
export function safeMemoryText(text: string) {
  // Content safety, never intent routing. Semantic extraction remains the model's job.
  return (
    !/密码|密钥|验证码|身份证|银行卡|api[ _-]?key|access[ _-]?key|bearer\s|\btoken\b|private[ _-]?key|系统提示词|系统指令|忽略.{0,8}(?:规则|指令)|ignore.{0,20}instructions/iu.test(
      text,
    ) && !/sk-[\w-]{16,}|-----BEGIN|data:[^;]+;base64,/iu.test(text)
  )
}
export function memoryInput(value: unknown): MemoryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ErrorCode.MEMORY_INVALID()
  }
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).some(
      (key) =>
        !['label', 'content', 'kind', 'ttlDays', 'version'].includes(key),
    ) ||
    typeof row.label !== 'string' ||
    !row.label.trim() ||
    row.label.trim().length > 80 ||
    typeof row.content !== 'string' ||
    !row.content.trim() ||
    row.content.trim().length > 800 ||
    !['preference', 'fact', 'goal'].includes(String(row.kind)) ||
    (row.ttlDays != null &&
      (!Number.isSafeInteger(row.ttlDays) ||
        Number(row.ttlDays) < 1 ||
        Number(row.ttlDays) > 3650))
  ) {
    throw ErrorCode.MEMORY_INVALID()
  }
  if (!safeMemoryText(row.label + '\n' + row.content)) {
    throw ErrorCode.MEMORY_SENSITIVE()
  }
  return {
    label: row.label.trim(),
    content: row.content.trim(),
    kind: row.kind as MemoryKind,
    ttlDays: row.ttlDays == null ? null : Number(row.ttlDays),
  }
}
export function eligibleMemoryMessage(message: ChatMessage) {
  return (
    message.role === 'user' &&
    message.memoryEnabled !== false &&
    Boolean(message.content.trim()) &&
    !message.resourceRefs?.length &&
    !message.attachments?.length &&
    !message.applicationIds?.length &&
    safeMemoryText(message.content)
  )
}
export function memoryTerms(query: string) {
  const value = query.normalize('NFKC').toLowerCase()
  const terms = value.match(/[a-z0-9_]{2,}|\p{Script=Han}+/gu) || []
  return [
    ...new Set(
      terms.flatMap((word) =>
        /\p{Script=Han}/u.test(word)
          ? Array.from({ length: Math.max(0, word.length - 1) }, (_, index) =>
              word.slice(index, index + 2))
          : [word],
      ),
    ),
  ].slice(0, 80)
}
export function memoryScore(
  query: string,
  label: string,
  content: string,
  kind: MemoryKind,
) {
  const text = `${label} ${content}`.normalize('NFKC').toLowerCase()
  return memoryTerms(query).reduce(
    (score, term) => score + (text.includes(term) ? 2 : 0),
    kind === 'preference' ? 1 : 0,
  )
}
