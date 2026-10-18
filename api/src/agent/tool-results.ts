import type { ConfigurationSnapshot, ToolResult } from '@t-box/shared'
import type { ProviderItem } from '../chat/provider.js'
import type { ToolContext } from './contracts.js'
import { settingNumber } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'

/** Full receipts remain in the journal/session; only the model view is bounded. */
export function modelToolResult(
  result: ToolResult,
  callId: string,
  configuration?: ConfigurationSnapshot,
): ToolResult {
  const bytes = settingNumber(
    configuration,
    'ai.context.toolResultBytes',
    12288,
  )
  const json = JSON.stringify(result)
  if (Buffer.byteLength(json, 'utf8') <= bytes) {
    return result
  }
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code.slice(0, 80),
        message: result.error.message.slice(0, 500),
      },
    }
  }
  return {
    ok: true,
    data: {
      resultRef: { callId, path: '/data' },
      truncated: true,
      preview: new TextDecoder().decode(
        Buffer.from(json).subarray(0, Math.floor(bytes / 2)),
      ),
      note: '完整回执保留；使用 tool_result_read(callId, path, offset, limit) 按路径和分页读取。预览不保证包含全部字段，不得推断未显示的结果。',
    },
  }
}

export function boundedToolHistory(
  history: ProviderItem[],
  ctx: ToolContext,
): ProviderItem[] {
  if (!ctx.capabilities) {
    return history
  }
  return history.map((item) => {
    if (item.type !== 'function_call_output' || !item.call_id) {
      return item
    }
    const stored = ctx.session.calls.get(item.call_id)
    if (!stored) {
      return item
    }
    return {
      ...item,
      output: JSON.stringify(
        modelToolResult(stored.result, item.call_id, ctx.configurationSnapshot),
      ),
    }
  })
}

/** Read existing evidence only; never re-invoke a business tool to recover omitted data. */
export async function readToolResult(
  callId: string,
  path: string,
  offset: number,
  limit: number,
  ctx: ToolContext,
) {
  const stored = ctx.session.calls.get(callId)
  const colon = stored?.fingerprint.indexOf(':') ?? -1
  const name = colon >= 0 ? stored!.fingerprint.slice(0, colon) : ''
  const tool = ctx.registry.tools[name]
  if (
    !stored ||
    !tool ||
    (tool.effect === 'configuration' && name !== 'agent_delegate') ||
    ['tool_result_read', 'capability_search', 'capability_load'].includes(
      name,
    ) ||
    (ctx.toolAllowlist && !ctx.toolAllowlist.has(name))
  ) {
    throw ErrorCode.TOOL_RESULT_NOT_FOUND('工具回执不存在或不在当前助手范围内')
  }
  // Recheck installation/version. Conversation resource authorization is also
  // checked on every orchestrator iteration, including resumed read operations.
  let args: unknown
  try {
    args = JSON.parse(stored.fingerprint.slice(colon + 1))
  } catch {
    /* Failed original arguments are still a readable historical receipt. */
  }
  await ctx.registry.requireResultSource(name, args, ctx, callId)
  let value: unknown = stored.result
  if (path && !path.startsWith('/')) {
    throw ErrorCode.INVALID_RESULT_PATH()
  }
  for (const raw of path ? path.slice(1).split('/') : []) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !value ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key)
    ) {
      throw ErrorCode.TOOL_RESULT_PATH_NOT_FOUND()
    }
    value = (value as Record<string, unknown>)[key]
  }
  const base = { callId, path, offset }
  const budget = settingNumber(
    ctx.configurationSnapshot,
    'ai.context.toolResultBytes',
    12288,
  )
  const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')
  const project = (child: unknown, childPath: string) => {
    const json = JSON.stringify(child)
    return Buffer.byteLength(json, 'utf8') <= Math.min(2048, budget / 3)
      ? child
      : {
          truncated: true,
          resultRef: { callId, path: childPath },
          type: Array.isArray(child) ? 'array' : typeof child,
          note: '按此路径继续读取具体字段或分页。',
        }
  }
  if (typeof value === 'string') {
    let size = Math.min(limit * 100, 2000, value.length - offset)
    while (
      size > 0 &&
      Buffer.byteLength(
        JSON.stringify(value.slice(offset, offset + size)),
        'utf8',
      ) >
      budget / 2
    ) {
      size = Math.floor(size / 2)
    }
    return {
      ...base,
      value: value.slice(offset, offset + size),
      total: value.length,
      nextOffset: offset + size < value.length ? offset + size : null,
    }
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    const page: [string, unknown][] = []
    for (const [key, child] of entries.slice(offset, offset + limit)) {
      const next: [string, unknown] = [
        key,
        project(child, `${path}/${escape(key)}`),
      ]
      if (
        page.length &&
        Buffer.byteLength(JSON.stringify([...page, next]), 'utf8') > budget / 2
      ) {
        break
      }
      page.push(next)
    }
    return {
      ...base,
      value: Array.isArray(value)
        ? page.map(([, child]) => child)
        : Object.fromEntries(page),
      total: entries.length,
      nextOffset:
        offset + page.length < entries.length ? offset + page.length : null,
    }
  }
  return { ...base, value, total: 1, nextOffset: null }
}
