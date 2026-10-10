import { invokeApplicationTool } from "./app-runtime/bridge";
import { clientApplicationTools } from "../applications/registry";
import type { ToolResult } from "@t-box/shared";
import { openApplication } from "./navigation";

type ClientTool = (args: unknown) => Promise<unknown>;
const registry: Readonly<Record<string, ClientTool>> = Object.freeze({
  app_open: openApplication,
  application_invoke: (args) => invokeApplicationTool(args, openApplication),
  ...clientApplicationTools,
});

export const clientCapabilities = Object.keys(registry);

/** A fixed allowlist: no eval, shell commands, dynamic imports, or arbitrary navigation. */
export async function executeClientTool(
  name: string,
  args: unknown,
): Promise<ToolResult> {
  const execute = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!execute)
    return {
      ok: false,
      error: { code: "UNSUPPORTED_CLIENT_TOOL", message: "此操作暂不受支持。" },
    };
  try {
    return { ok: true, data: await execute(args) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_APP_ARGUMENTS",
        message: error instanceof Error ? error.message : "无法打开应用。",
      },
    };
  }
}
