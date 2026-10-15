import type { BackendPreparationResult } from '@t-box/app-contracts'
import type { ApplicationModule, ApplicationToolContext } from './contracts.js'

interface Invocation {
  appId: string
  releaseId: string
  generation: number
  method: string
  arguments: unknown
  invocationId: string
  preparationTicket?: string
}

export interface RemoteToolPort {
  invoke(
    input: Invocation,
    context: ApplicationToolContext,
  ): Promise<unknown>
  prepare?(input: { invocation: Invocation, continuation?: string, response?: { ok: boolean, data?: unknown, error?: { code: string, message: string } } }, context: ApplicationToolContext): Promise<BackendPreparationResult>
}
/** Schemas, validation, confirmation and resource requirements remain owned by the application. */
export function bindRemoteTools(
  module: ApplicationModule,
  methods: Readonly<Record<string, string>>,
  port: RemoteToolPort,
): ApplicationModule {
  const tools = { ...module.tools }
  for (const [name, method] of Object.entries(methods)) {
    const declaration = tools[name]
    if (
      !declaration ||
      declaration.execution !== 'server' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(method)
    ) {
      throw new Error('Invalid remote tool binding')
    }
    const invocation = (args: unknown, context: ApplicationToolContext): Invocation => {
      if (!context.application || context.application.appId !== module.id || !context.callId) {
        throw new Error('Remote tool requires an installed, pinned application context')
      }
      return { ...context.application, method, arguments: args, invocationId: context.callId }
    }
    const prepare = (args: unknown, context: ApplicationToolContext) => context.use(`remote-preflight:${module.id}:${context.callId}`, async () => {
      if (!port.prepare) {
        return undefined
      }
      let input: Parameters<NonNullable<RemoteToolPort['prepare']>>[0] = { invocation: invocation(args, context) }
      for (let step = 0; step < 8; step++) {
        context.signal.throwIfAborted()
        const result = await port.prepare(input, context)
        if (result.status === 'ready') {
          return result.ticket
        }
        const action = module.interactions?.find((entry) => entry.name === result.request.name)
        if (!action) {
          throw new Error('Remote service requested an undeclared client interaction')
        }
        // This runs inside validate, before the journal marks a write as dispatched.
        const response = await context.interact(result.request)
        if (!response.ok) {
          throw new Error('Application interaction was not completed')
        }
        input = { invocation: invocation(args, context), continuation: result.continuation, response }
      }
      throw new Error('Application preparation exceeded the interaction limit')
    })
    tools[name] = {
      ...declaration,
      validate: async (args, context) => {
        await declaration.validate?.(args, context)
        await prepare(args, context)
      },
      handler: async (args, context) => {
        if (
          !context.application ||
          context.application.appId !== module.id ||
          !context.callId
        ) {
          throw new Error(
            'Remote tool requires an installed, pinned application context',
          )
        }
        return port.invoke(
          {
            ...invocation(args, context),
            preparationTicket: await prepare(args, context),
          },
          context,
        )
      },
    }
  }
  return { ...module, tools }
}
