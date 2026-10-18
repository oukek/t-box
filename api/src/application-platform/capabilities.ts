import type { ApplicationModule } from '../agent/contracts.js'
import type { ApplicationPlatform } from './service.js'
import { ErrorCode } from '../error-codes.js'
/** Install policy is applied uniformly to local modules and independently deployed applications. */
export function bindInstalledCapabilities(
  module: ApplicationModule,
  platform?: ApplicationPlatform,
): ApplicationModule {
  if (!platform || !module.manifest) {
    return module
  }
  return {
    ...module,
    availability: async (actor) => {
      if (!actor) {
        throw ErrorCode.AUTH_REQUIRED()
      }
      const current = await platform.assertActive(actor.user.id, module.id)
      await module.availability?.(actor)
      return `${current.release.releaseId}:${current.installation.generation}`
    },
    tools: Object.fromEntries(
      Object.entries(module.tools).map(([name, tool]) => [
        name,
        tool.clientAction === 'application_invoke'
          ? {
              ...tool,
              normalizeClientArguments: async (value, context) => {
                if (!context.actor) {
                  throw ErrorCode.AUTH_REQUIRED()
                }
                const runtime = await platform.runtime(
                  context.actor.user.id,
                  module.id,
                  'web',
                )
                if (!runtime.clientTools.includes(name)) {
                  throw ErrorCode.APP_TOOL_UNAVAILABLE()
                }
                return {
                  appId: module.id,
                  releaseId: runtime.releaseId,
                  generation: runtime.generation,
                  tool: name,
                  arguments: await tool.normalizeClientArguments!(
                    value,
                    context,
                  ),
                }
              },
            }
          : tool,
      ]),
    ),
  }
}
