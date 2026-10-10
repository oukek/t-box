import { createCapabilities } from "../src/bootstrap/chat.js";
import type { BillRepository } from "@t-box/ledger-server/repository";
import type { CategoryRepository } from "@t-box/ledger-server/categories/repository";
import type { ToolContext } from "../src/agent/contracts.js";
import { MemorySessionRepository } from "../src/chat/session.js";
import { ApiError } from "@t-box/server-foundation/errors";
export const registry = createCapabilities({ bills: {} as BillRepository });
export const TOOL_REGISTRY = registry.tools;
export const allowedTools = (skills: Set<string>) =>
  registry.allowedTools(skills);
export async function serverTool(
  name: string,
  value: unknown,
  skills: Set<string>,
  bills: BillRepository,
  categories?: CategoryRepository,
  extra?: Record<string, (args: unknown) => Promise<unknown>>,
) {
  const local = createCapabilities({ bills, categories });
  const tool = local.tools[name];
  if (
    !local.allowedTools(skills).some((tool) => tool.name === name) ||
    !tool?.handler
  )
    throw new ApiError(400, "TOOL_NOT_ALLOWED", "工具未注册或尚未启用");
  const ctx: ToolContext = {
    registry: local,
    skills,
    bindings: [],
    session: new MemorySessionRepository().create(),
    requestId: "test",
    signal: new AbortController().signal,
    interact: async () => ({
      ok: false,
      error: { code: "NO_CLIENT", message: "没有客户端" },
    }),
    use: async (_key, factory) => factory(),
  };
  // Domain tests can provide specialized repositories without affecting runtime wiring.
  if (extra) ctx.use = async () => ({ bills, categories, extra }) as any;
  return tool.handler(value, ctx);
}
