import type { ApplicationModule, ApplicationToolContext } from "./contracts.js";
export interface RemoteToolPort {
  invoke(
    input: {
      appId: string;
      releaseId: string;
      generation: number;
      method: string;
      arguments: unknown;
      invocationId: string;
    },
    context: ApplicationToolContext,
  ): Promise<unknown>;
}
/** Schemas, validation, confirmation and resource requirements remain owned by the application. */
export function bindRemoteTools(
  module: ApplicationModule,
  methods: Readonly<Record<string, string>>,
  port: RemoteToolPort,
): ApplicationModule {
  const tools = { ...module.tools };
  for (const [name, method] of Object.entries(methods)) {
    const declaration = tools[name];
    if (
      !declaration ||
      declaration.execution !== "server" ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(method)
    )
      throw new Error("Invalid remote tool binding");
    tools[name] = {
      ...declaration,
      handler: async (args, context) => {
        if (
          !context.application ||
          context.application.appId !== module.id ||
          !context.callId
        )
          throw new Error(
            "Remote tool requires an installed, pinned application context",
          );
        return port.invoke(
          {
            ...context.application,
            method,
            arguments: args,
            invocationId: context.callId,
          },
          context,
        );
      },
    };
  }
  return { ...module, tools };
}
