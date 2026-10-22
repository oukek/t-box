import type {
  ApplicationToolDefinition,
  ConfigurationSnapshot,
} from '@t-box/shared'
import type {
  ApplicationModule,
  SkillDefinition,
  ToolContext,
  ToolRegistration,
} from './contracts.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { settingNumber } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'

/** Run/frame-local discovery state. Never an authorization grant. Persisted with checkpoints. */
export interface CapabilitySelection {
  loadedTools: string[]
  applications: string[]
}

export const discoveryTools = new Set([
  'memory_search',
  'capability_search',
  'capability_load',
  'tool_result_read',
  'conversation_history_read',
])

export function capabilityBudget(
  configuration?: ConfigurationSnapshot,
  modelBudget = Number.POSITIVE_INFINITY,
) {
  return {
    tools: settingNumber(configuration, 'ai.tools.maxLoaded', 16),
    bytes: Math.min(
      settingNumber(configuration, 'ai.tools.maxSchemaBytes', 32768),
      modelBudget,
    ),
    instructions: Math.min(
      settingNumber(configuration, 'ai.tools.maxInstructionBytes', 16384),
      modelBudget,
    ),
    results: settingNumber(configuration, 'ai.tools.searchPageSize', 6),
    applications: settingNumber(configuration, 'ai.tools.maxApplications', 8),
  }
}

export function schemaBytes(tools: ApplicationToolDefinition[]) {
  return Buffer.byteLength(JSON.stringify(tools), 'utf8')
}

/** Metadata retrieval, not intent routing: the model chooses/rephrases the query. */
export function capabilityScore(query: string, fields: string[]) {
  const text = fields.join(' ').normalize('NFKC').toLowerCase()
  const normalized = query.normalize('NFKC').trim().toLowerCase()
  if (!normalized) {
    return 1
  }
  const words = normalized.match(/[a-z0-9_]+|\p{Script=Han}+/gu) || []
  let score = text.includes(normalized) ? 20 : 0
  for (const word of words) {
    if (text.includes(word)) {
      score += 8
    } else if (/\p{Script=Han}/u.test(word)) {
      for (let index = 0; index + 1 < word.length; index++) {
        if (text.includes(word.slice(index, index + 2))) {
          score++
        }
      }
    }
  }
  return score
}

/** Generic application-contract discovery; no application business imports. */
export class CapabilityLoader {
  private readonly owners = new Map<string, ApplicationModule>()
  private indexed = false
  constructor(
    private readonly modules: ReadonlyMap<string, ApplicationModule>,
    private readonly tools: Readonly<Record<string, ToolRegistration>>,
    private readonly skills: Readonly<Record<string, SkillDefinition>>,
    private readonly port: {
      requireModule(id: string, ctx: ToolContext): Promise<void>
      availableModules(ctx: ToolContext): Promise<Set<string>>
    },
  ) {}

  owner(name: string) {
    if (!this.indexed) {
      for (const module of this.modules.values()) {
        for (const name of Object.keys(module.tools)) {
          this.owners.set(name, module)
        }
      }
      this.indexed = true
    }
    return this.owners.get(name)
  }

  /** Exact-name loading activates only owning skills, with MRU eviction of old schemas. */
  async loadTools(names: readonly string[], ctx: ToolContext) {
    const budget = capabilityBudget(
      ctx.configurationSnapshot,
      ctx.toolSchemaBudget,
    )
    const requested = [...new Set(names)]
    if (!requested.length || requested.length > budget.tools) {
      throw ErrorCode.TOOL_LOAD_LIMIT()
    }
    for (const name of requested) {
      const module = this.owner(name)
      if (
        !module ||
        module.id === 'shell' ||
        (ctx.applicationAllowlist &&
          !ctx.applicationAllowlist.has(module.id)) ||
          (ctx.toolAllowlist && !ctx.toolAllowlist.has(name))
      ) {
        throw ErrorCode.TOOL_NOT_ALLOWED()
      }
      await this.port.requireModule(module.id, ctx)
      if (
        ctx.skillAllowlist &&
        !Object.entries(module.skills).some(
          ([id, skill]) =>
            skill.tools.includes(name) && ctx.skillAllowlist!.has(id),
        )
      ) {
        throw ErrorCode.TOOL_NOT_ALLOWED('工具未声明可用技能')
      }
    }
    const bytes = (list: string[]) =>
      schemaBytes(list.map((name) => this.tools[name]!.definition))
    const applications = (list: string[]) =>
      new Set(list.map((name) => this.owner(name)!.id)).size
    if (applications(requested) > budget.applications) {
      throw ErrorCode.TOOL_APPLICATION_LIMIT()
    }
    const instructionBytes = (list: string[]) => {
      const skills = new Set(
        list.map(
          (name) =>
            Object.entries(this.owner(name)!.skills).find(
              ([id, skill]) =>
                skill.tools.includes(name) &&
                (!ctx.skillAllowlist || ctx.skillAllowlist.has(id)),
            )?.[0],
        ),
      )
      return [...skills].reduce(
        (total, id) =>
          total +
          (id ? Buffer.byteLength(this.skills[id]!.instructions, 'utf8') : 0),
        0,
      )
    }
    if (bytes(requested) > budget.bytes) {
      throw ErrorCode.TOOL_SCHEMA_LIMIT()
    }
    if (instructionBytes(requested) > budget.instructions) {
      throw ErrorCode.TOOL_INSTRUCTIONS_LIMIT()
    }
    const previous = ctx.capabilities?.loadedTools || []
    const loaded = [
      ...previous.filter((name) => !requested.includes(name)),
      ...requested,
    ]
    while (
      loaded.length > budget.tools ||
      applications(loaded) > budget.applications ||
      bytes(loaded) > budget.bytes ||
      instructionBytes(loaded) > budget.instructions
    ) {
      loaded.shift()
    }
    if (ctx.capabilities) {
      ctx.capabilities.loadedTools = loaded
      ctx.capabilities.applications = [
        ...new Set([
          ...ctx.capabilities.applications,
          ...loaded.map((name) => this.owner(name)!.id),
        ]),
      ].slice(-budget.applications)
      ctx.skills.clear()
    }
    for (const name of loaded) {
      const skill = Object.entries(this.owner(name)!.skills).find(
        ([id, skill]) =>
          skill.tools.includes(name) &&
          (!ctx.skillAllowlist || ctx.skillAllowlist.has(id)),
      )
      if (skill) {
        ctx.skills.add(skill[0])
      }
    }
    return {
      loadedTools: requested,
      evictedTools: previous.filter((name) => !loaded.includes(name)),
      selection: ctx.capabilities
        ? structuredClone(ctx.capabilities)
        : undefined,
    }
  }

  async restoreCapabilities(
    result: import('@t-box/shared').ToolResult,
    ctx: ToolContext,
  ) {
    if (!result.ok || !ctx.capabilities) {
      return
    }
    const selection = (result.data as { selection?: CapabilitySelection })
      ?.selection
    if (selection?.loadedTools.length) {
      await this.loadTools(selection.loadedTools, ctx)
      const available = await this.port.availableModules(ctx)
      ctx.capabilities.applications = selection.applications
        .filter(
          (id) =>
            available.has(id) &&
            (!ctx.applicationAllowlist || ctx.applicationAllowlist.has(id)),
        )
        .slice(-capabilityBudget(ctx.configurationSnapshot).applications)
    }
  }

  async searchCapabilities(
    query: string,
    appId: string | null,
    offset: number,
    ctx: ToolContext,
  ) {
    const available = await this.port.availableModules(ctx)
    const budget = capabilityBudget(
      ctx.configurationSnapshot,
      ctx.toolSchemaBudget,
    )
    const results = [...this.modules.values()]
      .filter(
        (module) =>
          module.id !== 'shell' &&
          available.has(module.id) &&
          (!appId || appId === module.id) &&
          (!ctx.applicationAllowlist ||
            ctx.applicationAllowlist.has(module.id)),
      )
      .flatMap((module) =>
        Object.entries(module.tools)
          .filter(([name]) => !ctx.toolAllowlist || ctx.toolAllowlist.has(name))
          .map(([name, tool]) => {
            const skills = Object.entries(module.skills).filter(
              ([id, skill]) =>
                skill.tools.includes(name) &&
                (!ctx.skillAllowlist || ctx.skillAllowlist.has(id)),
            )
            return {
              name,
              title: tool.title,
              description: (tool.definition.description || '').slice(0, 600),
              applicationId: module.id,
              applicationName: module.manifest?.name || module.id,
              skillIds: skills.map(([id]) => id),
              agents: (module.agents || [])
                .filter(
                  (agent) =>
                    ctx.agentId === 'assistant' &&
                    agent.skillIds.some((id) =>
                      skills.some(([skillId]) => skillId === id),
                    ),
                )
                .map(({ id, title, description }) => ({
                  id,
                  title,
                  description: description.slice(0, 300),
                })),
              effect: tool.effect,
              execution: tool.execution,
              receiptCompletion: Boolean(tool.completionSummary),
              score: capabilityScore(query, [
                name,
                tool.title,
                tool.definition.description || '',
                module.manifest?.name || module.id,
                module.manifest?.description || '',
                ...skills.map(
                  ([id, skill]) => `${id} ${skill.title} ${skill.description}`,
                ),
              ]),
            }
          }),
      )
      .filter(
        (item) =>
          (!ctx.skillAllowlist || item.skillIds.length) && item.score > 0,
      )
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    const page = results.slice(offset, offset + budget.results)
    const loadable = page.filter(
      (item) =>
        schemaBytes([this.tools[item.name]!.definition]) <= budget.bytes,
    )
    const names: string[] = []
    for (const item of loadable) {
      if (
        names.length < budget.tools &&
        schemaBytes(
          [...names, item.name].map((name) => this.tools[name]!.definition),
        ) <= budget.bytes
      ) {
        names.push(item.name)
      }
    }
    let loaded: {
      loadedTools: string[]
      evictedTools: string[]
      selection?: CapabilitySelection
    } = { loadedTools: [], evictedTools: [] }
    while (names.length) {
      try {
        loaded = await this.loadTools(names, ctx)
        break
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          ![
            'TOOL_LOAD_LIMIT',
            'TOOL_SCHEMA_LIMIT',
            'TOOL_INSTRUCTIONS_LIMIT',
            'TOOL_APPLICATION_LIMIT',
          ].includes(error.code)
        ) {
          throw error
        }
        names.pop()
      }
    }
    return {
      results: page.map(({ score: _score, ...item }) => item),
      ...loaded,
      total: results.length,
      nextOffset:
        offset + page.length < results.length ? offset + page.length : null,
      note: '检索和加载不代表授权执行。需要其他能力可改写关键词，或 query 为空并结合 appId/offset 分页浏览；只有 loadedTools 中的业务函数会按阶段开放。',
    }
  }
}
