import type { ToolRegistration } from './contracts.js'
import { invalid } from '@t-box/server-foundation/errors'
import { definition, nullable, object } from './schema.js'
import { readToolResult } from './tool-results.js'

const invalidText = (value: unknown, max: number) => value != null && (typeof value !== 'string' || value.length > max)
const invalidInteger = (value: unknown, min: number, max: number) => value != null && (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)

/** Host-only tools: applications do not implement discovery, memory or result paging. */
export function createDiscoveryTools(): Record<string, ToolRegistration> {
  return {
    conversation_history_read: {
      definition: definition('conversation_history_read', '检索或分页读取当前会话的公开原始消息，不返回内部摘要、Prompt、其他会话或隐藏推理。query 为空可按 beforeMessageId 分页；长消息用 messageId 和 offset（Unicode 字符偏移）分段补读。', {
        query: nullable({ type: 'string', maxLength: 200 }),
        beforeMessageId: nullable({ type: 'string', maxLength: 100 }),
        limit: nullable({ type: 'integer', minimum: 1, maximum: 8 }),
        messageId: nullable({ type: 'string', maxLength: 100 }),
        offset: nullable({ type: 'integer', minimum: 0, maximum: 10000000 }),
      }),
      title: '查阅会话记录',
      execution: 'server',
      effect: 'read',
      alwaysAvailable: true,
      successSummary: '已查阅会话记录',
      async handler(value, ctx) {
        const args = object(value, ['query', 'beforeMessageId', 'limit', 'messageId', 'offset'])
        if (ctx.agentId && ctx.agentId !== 'assistant') {
          invalid('query', '专业助手不能读取主会话的其他历史')
        }
        if (invalidText(args.query, 200) || invalidText(args.beforeMessageId, 100) || invalidInteger(args.limit, 1, 8) || invalidText(args.messageId, 100) || invalidInteger(args.offset, 0, 10000000)) {
          invalid('query', '会话检索参数无效')
        }
        const all = ctx.session.messages
        if (args.messageId) {
          const message = all.find((message) => message.id === args.messageId && message.id !== ctx.session.active?.view.assistantMessageId)
          if (!message) {
            invalid('messageId', '消息不存在')
          }
          if (ctx.actor) {
            await ctx.registry.access.history(ctx.actor, [message], ctx.interact)
          }
          const content = [...message.content]
          const offset = Number(args.offset || 0)
          return { messages: [{ id: message.id, role: message.role, content: content.slice(offset, offset + 2000).join(''), offset, totalLength: content.length, nextOffset: offset + 2000 < content.length ? offset + 2000 : null }], nextBeforeMessageId: null }
        }
        const before = args.beforeMessageId ? all.findIndex((message) => message.id === args.beforeMessageId) : all.length
        if (before < 0) {
          invalid('beforeMessageId', '消息游标无效')
        }
        const query = String(args.query || '').normalize('NFKC').toLowerCase()
        const matches = all.slice(0, before).filter((message) => message.id !== ctx.session.active?.view.assistantMessageId && (!query || message.content.normalize('NFKC').toLowerCase().includes(query)))
        const selected = matches.slice(-Number(args.limit || 5))
        if (ctx.actor) {
          await ctx.registry.access.history(ctx.actor, selected, ctx.interact)
        }
        return {
          messages: selected.map((message) => {
            const content = [...message.content]
            return { id: message.id, role: message.role, content: content.slice(0, 2000).join(''), truncated: content.length > 2000, contentRef: content.length > 2000 ? { messageId: message.id, offset: 2000 } : undefined, createdAt: message.createdAt, attachments: message.attachments?.map(({ id, name, mimeType }) => ({ id, name, mimeType })), tools: message.toolCalls.map(({ id, name, status }) => ({ callId: id, name, status })) }
          }),
          nextBeforeMessageId: matches.length > selected.length ? selected[0]?.id : null,
          note: '历史助手消息可能包含未核实说法；操作是否成功仍以真实工具回执为准。查询仅限当前会话。',
        }
      },
    },
    capability_search: {
      definition: definition('capability_search', '按需检索已安装且有权限的应用工具，加载有限候选。query 使用简短关键词；空 query 可分页浏览。检索不执行业务操作。', {
        query: { type: 'string', maxLength: 200 },
        appId: nullable({ type: 'string', maxLength: 64 }),
        offset: nullable({ type: 'integer', minimum: 0, maximum: 100000 }),
      }),
      title: '查找可用能力',
      execution: 'server',
      effect: 'configuration',
      alwaysAvailable: true,
      successSummary: '已查找可用能力',
      restoreState: (result, ctx) => ctx.registry.restoreCapabilities(result, ctx),
      async handler(value, ctx) {
        const args = object(value, ['query', 'appId', 'offset'])
        if (typeof args.query !== 'string' || invalidText(args.query, 200) || invalidText(args.appId, 64) || invalidInteger(args.offset, 0, 100000)) {
          invalid('query', '检索参数无效')
        }
        return ctx.registry.searchCapabilities(args.query, args.appId as string | null, Number(args.offset || 0), ctx)
      },
    },
    capability_load: {
      definition: definition('capability_load', '按确切名称加载本任务所需的少量工具；自动加载其所属技能，超出预算时淘汰较早定义，不增加用户授权。', {
        toolNames: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', maxLength: 64 } },
      }),
      title: '加载任务工具',
      execution: 'server',
      effect: 'configuration',
      alwaysAvailable: true,
      successSummary: '所需工具已加载',
      restoreState: (result, ctx) => ctx.registry.restoreCapabilities(result, ctx),
      async handler(value, ctx) {
        const args = object(value, ['toolNames'])
        if (!Array.isArray(args.toolNames) || !args.toolNames.length || args.toolNames.length > 64 || args.toolNames.some((name) => typeof name !== 'string')) {
          invalid('toolNames', '请提供有效的工具名称')
        }
        return ctx.registry.loadTools(args.toolNames as string[], ctx)
      },
    },
    tool_result_read: {
      definition: definition('tool_result_read', '读取本会话已执行工具的完整回执。对 truncated/resultRef 使用 callId 和 JSON Pointer path（如 /data/items），通过 offset/limit 分页；不会重新执行业务工具。', {
        callId: { type: 'string', maxLength: 100 },
        path: { type: 'string', maxLength: 500 },
        offset: nullable({ type: 'integer', minimum: 0, maximum: 10000000 }),
        limit: nullable({ type: 'integer', minimum: 1, maximum: 50 }),
      }),
      title: '读取执行结果',
      execution: 'server',
      effect: 'read',
      alwaysAvailable: true,
      successSummary: '已读取执行结果',
      async handler(value, ctx) {
        const args = object(value, ['callId', 'path', 'offset', 'limit'])
        if (typeof args.callId !== 'string' || invalidText(args.callId, 100) || typeof args.path !== 'string' || invalidText(args.path, 500) || invalidInteger(args.offset, 0, 10000000) || invalidInteger(args.limit, 1, 50)) {
          invalid('path', '回执读取参数无效')
        }
        return readToolResult(args.callId, args.path, Number(args.offset || 0), Number(args.limit || 20), ctx)
      },
    },
  }
}
