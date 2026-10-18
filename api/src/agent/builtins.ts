import type { ApplicationModule } from './contracts.js'
import { invalid } from '@t-box/server-foundation/errors'
import { ErrorCode } from '../error-codes.js'
import { createDiscoveryTools } from './capability-tools.js'
import { definition, nullable, object } from './schema.js'
/** Shell capabilities contain no application fields or handlers. */
export function createShellModule(
  modules: readonly ApplicationModule[],
): ApplicationModule {
  const skillIds = modules.flatMap((module) => Object.keys(module.skills))
  const apps = modules.filter((module) => module.manifest && module.navigation)
  const agents = modules.flatMap((module) => module.agents || [])
  return {
    id: 'shell',
    skills: {},
    tools: {
      ...createDiscoveryTools(),
      ...(agents.length
        ? {
            agent_delegate: {
              definition: definition(
                'agent_delegate',
                '委派明确子任务给专业 Agent。专业 Agent 有独立上下文、技能和工具权限，结果返回后由主助手汇总。',
                {
                  agentId: {
                    type: 'string',
                    enum: agents.map((agent) => agent.id),
                  },
                  task: { type: 'string', maxLength: 2000 },
                },
              ),
              title: '专业 Agent 处理',
              execution: 'server' as const,
              effect: 'configuration' as const,
              alwaysAvailable: true,
              successSummary: '专业 Agent 已返回结果',
              handler: async () => {
                throw ErrorCode.INTERNAL_DELEGATION_MUST_BE_HANDLED_BY_THE_ORCHESTRATOR()
              },
            },
          }
        : {}),
      skill_activate: {
        definition: definition(
          'skill_activate',
          '按需启用已注册的技能与工具。',
          { skillId: { type: 'string', enum: skillIds } },
        ),
        title: '启用技能',
        execution: 'server',
        effect: 'configuration',
        alwaysAvailable: true,
        successSummary: '技能已启用',
        async restoreState(result, ctx) {
          if (!result.ok) {
            return
          }
          const data = result.data as { skillId?: unknown, loaded?: boolean }
          const id = data?.skillId
          if (data?.loaded === false) {
            return
          }
          if (
            typeof id === 'string' &&
            Object.hasOwn(ctx.registry.skills, id) &&
            (!ctx.skillAllowlist || ctx.skillAllowlist.has(id))
          ) {
            if (ctx.capabilities) {
              await ctx.registry.loadTools(ctx.registry.skills[id]!.tools, ctx)
            } else {
              ctx.skills.add(id)
            }
          }
        },
        async handler(value, ctx) {
          const args = object(value, ['skillId'])
          if (
            typeof args.skillId !== 'string' ||
            !Object.hasOwn(ctx.registry.skills, args.skillId) ||
            (ctx.skillAllowlist && !ctx.skillAllowlist.has(args.skillId))
          ) {
            invalid('skillId', '技能未注册')
          }
          const previousSkills = [...ctx.skills]
          ctx.skills.add(args.skillId)
          const skill = ctx.registry.skills[args.skillId]!
          if (ctx.capabilities) {
            // Do not expand a large skill wholesale; exact tools can be searched/loaded.
            try {
              await ctx.registry.loadTools(skill.tools, ctx)
            } catch (error) {
              if (!(
                error &&
                typeof error === 'object' &&
                'code' in error &&
                [
                  'TOOL_LOAD_LIMIT',
                  'TOOL_SCHEMA_LIMIT',
                  'TOOL_INSTRUCTIONS_LIMIT',
                ].includes(String(error.code))
              )) {
                throw error
              }
              ctx.skills.clear()
              previousSkills.forEach((id) => ctx.skills.add(id))
              return {
                skillId: args.skillId,
                title: skill.title,
                version: skill.version,
                loaded: false,
                note: '技能包含的工具超出预算，请使用 capability_search 或 capability_load 选择本次所需工具。',
              }
            }
          }
          return {
            skillId: args.skillId,
            title: skill.title,
            version: skill.version,
            tools: skill.tools,
          }
        },
      },
      app_open: {
        definition: definition(
          'app_open',
          '打开注册应用。params 使用该应用的导航字段，可选字段传 null。',
          {
            appId: { type: 'string', enum: apps.map((module) => module.id) },
            params: nullable({
              anyOf: apps.map((module) => ({
                type: 'object',
                properties: module.navigation!.properties,
                required: Object.keys(module.navigation!.properties),
                additionalProperties: false,
              })),
            }),
          },
        ),
        title: '打开应用',
        execution: 'client',
        effect: 'ui',
        alwaysAvailable: true,
        successSummary: '应用已打开',
        normalizeClientArguments: (value, ctx) => {
          const destination = ctx.registry.destination(value, ctx)
          if (
            ctx.applicationAllowlist &&
            !ctx.applicationAllowlist.has(destination.appId)
          ) {
            invalid('appId', '当前专业 Agent 不可打开此应用')
          }
          return destination
        },
        sanitizeClientResult: (result) =>
          result.ok ? { ok: true, data: { opened: true } } : result,
      },
    },
  }
}
