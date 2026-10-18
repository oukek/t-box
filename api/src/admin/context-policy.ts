import type { ContextPolicy } from '@t-box/shared'
import { contextOutputBudget, DEFAULT_CONTEXT_POLICY } from '@t-box/shared'
import { ErrorCode } from '../error-codes.js'

export function contextPolicy(
  value: unknown,
  reasoning = false,
): Required<ContextPolicy> {
  let v: unknown
  try {
    v = typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    throw ErrorCode.INVALID_CONTEXT_POLICY()
  }
  if (v == null) {
    return { ...DEFAULT_CONTEXT_POLICY }
  }
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw ErrorCode.INVALID_CONTEXT_POLICY()
  }
  const raw = v as Record<string, unknown>
  // Existing records with native compression disabled gain portable summarization.
  // Explicit 'off' is retained. This is normalization, so no schema migration is needed.
  const x = {
    ...DEFAULT_CONTEXT_POLICY,
    ...raw,
    compactionMode:
      raw.compactionMode ?? (raw.compaction ? 'native' : 'summary'),
  } as Required<ContextPolicy>
  const integer = (n: unknown, min: number, max: number) =>
    Number.isInteger(n) && Number(n) >= min && Number(n) <= max
  if (
    Object.keys(raw).some((k) => !(k in DEFAULT_CONTEXT_POLICY)) ||
    !integer(x.maxInputTokens, 8192, 2_000_000) ||
    !(x.maxOutputTokens === 0 || integer(x.maxOutputTokens, 1024, 262144)) ||
    !(
      x.contextWindowTokens === 0 ||
      integer(x.contextWindowTokens, 16384, 2_000_000)
    ) ||
    !integer(x.keepRecentTurns, 1, 12) ||
    !integer(x.summaryTargetTokens, 512, 8192) ||
    typeof x.compactionThreshold !== 'number' ||
    !Number.isFinite(x.compactionThreshold) ||
    x.compactionThreshold < 0.5 ||
    x.compactionThreshold > 0.9 ||
    !['summary', 'native', 'off'].includes(x.compactionMode) ||
    [x.compaction, x.promptCacheKey, x.tokenCounting].some(
      (v) => typeof v !== 'boolean',
    )
  ) {
    throw ErrorCode.INVALID_CONTEXT_POLICY(
      '上下文预算或压缩配置无效，请检查字段范围',
    )
  }
  if (
    x.contextWindowTokens &&
    x.contextWindowTokens - contextOutputBudget(x, reasoning) - 1024 < 8192
  ) {
    throw ErrorCode.INVALID_CONTEXT_POLICY(
      '总窗口需至少容纳输出预算、8192 输入 token 及 1024 安全余量',
    )
  }
  x.compaction = x.compactionMode !== 'off'
  return x
}
