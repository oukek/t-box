import type { FastifyInstance } from 'fastify'
import type { RunCheckpoint } from '../agent/checkpoint.js'
import type { CapabilityRegistry } from '../agent/registry.js'
import type { PlatformService } from '../platform/service.js'
import { parseId } from '@t-box/server-foundation/validation'
import { bearer } from '../identity/service.js'
import { publicTaskTool } from './presentation.js'

export function registerTasks(
  app: FastifyInstance,
  p: PlatformService,
  registry: CapabilityRegistry,
) {
  const access = registry.access
  app.get('/api/v1/tasks', async (req) => {
    const actor = await p.identity.authenticate(
      bearer(req.headers.authorization),
    )
    const [tasks, conversations] = await Promise.all([
      p.tasks.list(actor),
      p.conversations.list(actor),
    ])
    const summaries = new Map(conversations.map((item) => [item.id, item]))
    return {
      data: tasks.map((task) => ({
        ...task,
        title: summaries.get(task.conversationId)?.title || '待恢复的对话',
        protectedResources:
          summaries.get(task.conversationId)?.protectedResources || [],
        unavailable: summaries.get(task.conversationId)?.unavailable || false,
        agentTitle: registry.agents.get(task.agentId)?.title || '日常助手',
      })),
    }
  })
  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id', async (req) => {
    const actor = await p.identity.authenticate(
      bearer(req.headers.authorization),
    )
    const task = await p.tasks.get(actor, parseId(req.params.id))
    const checkpoint = task.checkpoint as RunCheckpoint
    // Check ownership, membership and temporary resource grants before revealing results.
    await access.history(actor, checkpoint.session.messages)
    return {
      data: {
        ...task.summary,
        tools: task.tools.map((tool) => publicTaskTool(tool, registry.tools[tool.name]?.title || '应用工具')),
        resourceRefs: access.references(checkpoint.session.messages),
      },
    }
  })
  app.post<{ Params: { id: string } }>(
    '/api/v1/tasks/:id/cancel',
    async (req) => {
      const actor = await p.identity.authenticate(
        bearer(req.headers.authorization),
      )
      await p.tasks.cancel(actor, parseId(req.params.id))
      return { data: (await p.tasks.get(actor, req.params.id)).summary }
    },
  )
}
