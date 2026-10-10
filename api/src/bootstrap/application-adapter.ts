import type {
  ApplicationModule as SdkModule,
  ApplicationToolContext,
} from "../application-sdk/contracts.js";
import type {
  ApplicationModule,
  ToolContext,
  ToolRegistration,
} from "../agent/contracts.js";

/** Explicit boundary: applications never receive registry, journal, provider history or transport tokens. */
export function applicationContext(
  context: ToolContext,
  appId?: string,
): ApplicationToolContext {
  const pin = appId ? context.modulePins?.[appId] : undefined;
  const [releaseId, generation] = pin?.installation.split(":") || [];
  return Object.freeze({
    callId: context.callId,
    ...(appId && releaseId && Number.isSafeInteger(Number(generation))
      ? {
          application: Object.freeze({
            appId,
            releaseId,
            generation: Number(generation),
          }),
        }
      : {}),
    actor: context.actor ? structuredClone(context.actor) : undefined,
    bindings: structuredClone(context.bindings),
    requestId: context.requestId,
    signal: context.signal,
    interact: context.interact,
    use: context.use.bind(context),
    session: Object.freeze({
      messages: context.session.messages.map((message) => ({
        id: message.id,
        attachments: message.attachments
          ? structuredClone(message.attachments)
          : undefined,
      })),
      task: context.session.task ? { id: context.session.task.id } : undefined,
    }),
  });
}

export function adaptApplication(module: SdkModule): ApplicationModule {
  const tools: Record<string, ToolRegistration> = {};
  for (const [name, tool] of Object.entries(module.tools)) {
    tools[name] = {
      ...tool,
      ...(tool.handler
        ? {
            handler: (value, context) =>
              tool.handler!(value, applicationContext(context, module.id)),
          }
        : {}),
      ...(tool.resources
        ? {
            resources: (value, context) =>
              tool.resources!(value, applicationContext(context, module.id)),
          }
        : {}),
      ...(tool.confirm
        ? {
            confirm: (value, context) =>
              tool.confirm!(value, applicationContext(context, module.id)),
          }
        : {}),
      ...(tool.validate
        ? {
            validate: (value, context) =>
              tool.validate!(value, applicationContext(context, module.id)),
          }
        : {}),
      ...(tool.normalizeClientArguments
        ? {
            normalizeClientArguments: (value, context) =>
              tool.normalizeClientArguments!(
                value,
                applicationContext(context, module.id),
              ),
          }
        : {}),
      ...(tool.restoreState
        ? {
            restoreState: (result, context) =>
              tool.restoreState!(
                result,
                applicationContext(context, module.id),
              ),
          }
        : {}),
    };
  }
  return {
    ...module,
    tools,
    ...(module.instructions
      ? {
          instructions: (context) =>
            module.instructions!(applicationContext(context, module.id)),
        }
      : {}),
    ...(module.navigation
      ? {
          navigation: {
            ...module.navigation,
            ...(module.navigation.contextualize
              ? {
                  contextualize: (params, context) =>
                    module.navigation!.contextualize!(
                      params,
                      applicationContext(context, module.id),
                    ),
                }
              : {}),
          },
        }
      : {}),
  };
}
