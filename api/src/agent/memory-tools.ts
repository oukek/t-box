import type { ToolContext, ToolRegistration } from './contracts.js'
import { ErrorCode } from '../error-codes.js'
import { memoryInput } from '../memory/policy.js'
import { definition, nullable, object } from './schema.js'

function host(ctx: ToolContext) {
  if (
    !ctx.actor ||
    !ctx.memory ||
    ctx.agentId !== 'assistant' ||
    ctx.configurationSnapshot?.values['ai.memory.enabled'] === false
  ) {
    throw ErrorCode.MEMORY_DISABLED()
  }
  return { actor: ctx.actor, memory: ctx.memory }
}
export function createMemoryTools(): Record<string, ToolRegistration> {
  return {
    memory_search: {
      definition: definition(
        'memory_search',
        '按当前用户需求查询已确认的跨会话记忆；只返回引用，下次模型请求会提供仍有效的参考。不是业务数据查询工具。',
        { query: { type: 'string', maxLength: 200 } },
      ),
      title: '查阅相关记忆',
      execution: 'server',
      effect: 'configuration',
      alwaysAvailable: true,
      successSummary: '已查阅相关记忆',
      async handler(raw, ctx) {
        const { actor, memory } = host(ctx)
        const args = object(raw, ['query'])
        if (typeof args.query !== 'string' || args.query.length > 200) {
          throw ErrorCode.MEMORY_INVALID()
        }
        const items = await memory.search(actor, args.query)
        for (const item of items) {
          ctx.memoryIds?.add(item.id)
        }
        return {
          items,
          note: '记忆引用已选中，正文通过下一次请求的当前有效记忆参考提供。',
        }
      },
      restoreState(result, ctx) {
        if (
          !result.ok ||
          !result.data ||
          typeof result.data !== 'object' ||
          !('items' in result.data) ||
          !Array.isArray(result.data.items)
        ) {
          return
        }
        for (const row of result.data.items as unknown[]) {
          if (
            row &&
            typeof row === 'object' &&
            'id' in row &&
            typeof row.id === 'string'
          ) {
            ctx.memoryIds?.add(row.id)
          }
        }
      },
    },
    memory_remember: {
      definition: definition(
        'memory_remember',
        '仅当用户明确要求记住其个人偏好或阶段目标时使用。用户会确认后保存。不保存应用业务数据或任何凭据。',
        {
          label: { type: 'string', maxLength: 80 },
          content: { type: 'string', maxLength: 800 },
          kind: { type: 'string', enum: ['preference', 'fact', 'goal'] },
          ttlDays: nullable({ type: 'integer', minimum: 1, maximum: 3650 }),
        },
      ),
      title: '保存用户记忆',
      execution: 'server',
      effect: 'write',
      alwaysAvailable: true,
      successSummary: '记忆已保存',
      validate: async (raw, ctx) => {
        host(ctx)
        memoryInput(raw)
      },
      confirm: async (raw, ctx) => {
        host(ctx)
        return {
          name: 'memory_confirm',
          arguments: { action: 'remember', ...memoryInput(raw) },
        }
      },
      writeFingerprint: (raw) => JSON.stringify(memoryInput(raw)),
      async handler(raw, ctx) {
        const { actor, memory } = host(ctx)
        const message = ctx.session.messages.findLast(
          (message) => message.role === 'user',
        )
        if (!message || !ctx.session.conversationId) {
          throw ErrorCode.MEMORY_INVALID()
        }
        return memory.remember(
          actor,
          memoryInput(raw),
          { conversationId: ctx.session.conversationId, message },
          ctx.callId || ctx.requestId,
        )
      },
    },
    memory_forget: {
      definition: definition(
        'memory_forget',
        '用户明确要求忘记某项记忆时使用，先查阅获得 id，再由用户确认。删除记忆不会删除原聊天或应用数据。',
        { id: { type: 'string', maxLength: 36 } },
      ),
      title: '忘记用户记忆',
      execution: 'server',
      effect: 'write',
      alwaysAvailable: true,
      successSummary: '记忆已删除',
      writeFingerprint: (raw) => JSON.stringify(object(raw, ['id'])),
      confirm: async (raw, ctx) => {
        const { actor, memory } = host(ctx)
        const args = object(raw, ['id'])
        const item = (
          await memory.search(actor, typeof args.id === 'string' ? args.id : '')
        ).find((row) => row.id === args.id)
        if (!item) {
          throw ErrorCode.MEMORY_NOT_FOUND()
        }
        return {
          name: 'memory_confirm',
          arguments: { action: 'forget', label: item.label },
        }
      },
      async handler(raw, ctx) {
        const { actor, memory } = host(ctx)
        const args = object(raw, ['id'])
        if (typeof args.id !== 'string' || args.id === 'all') {
          throw ErrorCode.MEMORY_INVALID()
        }
        await memory.forget(actor, args.id)
        ctx.memoryIds?.delete(args.id)
        return { forgotten: true }
      },
    },
  }
}
