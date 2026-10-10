import { bindRemoteTools, type ApplicationModule } from "@t-box/app-server-sdk";
import { ApiError } from "@t-box/server-foundation/errors";
import type { ApplicationPlatform } from "../service.js";
/** A remote service participates in exactly the same AI execution journal and installation checks as local code. */
export function remoteApplicationModule(
  module: ApplicationModule,
  methods: Readonly<Record<string, string>>,
  platform: ApplicationPlatform,
) {
  return bindRemoteTools(module, methods, {
    invoke: async (input, context) => {
      if (!context.actor) throw new ApiError(401, "AUTH_REQUIRED", "请先登录");
      return platform.invoke(
        context.actor.user.id,
        input.appId,
        input.releaseId,
        input.generation,
        input.method,
        input.arguments,
        input.invocationId,
        context.signal,
      );
    },
  });
}
