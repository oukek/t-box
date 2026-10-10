import type { ApplicationModule } from '../agent/contracts.js'
import type { ApplicationPlatform } from './service.js'
import { ApiError } from '@t-box/server-foundation/errors'
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
        throw new ApiError(401, 'AUTH_REQUIRED', '请先登录')
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
                  throw new ApiError(401, 'AUTH_REQUIRED', '请先登录')
                }
                const runtime = await platform.runtime(
                  context.actor.user.id,
                  module.id,
                  'web',
                )
                if (!runtime.clientTools.includes(name)) {
                  throw new ApiError(
                    403,
                    'APP_TOOL_UNAVAILABLE',
                    '此版本未提供该前端工具',
                  )
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
