import type { DataSource } from "typeorm";
import type {
  AgentWorkflowConfiguration,
  AgentWorkflowPrompts,
} from "@t-box/shared";
import { ApiError } from "@t-box/server-foundation/errors";
import { defaultWorkflowPrompts } from "./defaults.js";
import { ConfigurationCache } from "../configuration/cache.js";
export function parseWorkflowPrompts(value: unknown): AgentWorkflowPrompts {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(
      400,
      "INVALID_WORKFLOW_PROMPTS",
      "阶段 Prompt 格式不正确",
    );
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !Object.hasOwn(defaultWorkflowPrompts, key),
    )
  )
    throw new ApiError(400, "INVALID_WORKFLOW_PROMPTS", "存在未知阶段");
  const prompts = {} as AgentWorkflowPrompts;
  for (const key of Object.keys(
    defaultWorkflowPrompts,
  ) as (keyof AgentWorkflowPrompts)[]) {
    const text = input[key];
    if (
      typeof text !== "string" ||
      text.trim().length < 20 ||
      text.length > 12000
    )
      throw new ApiError(
        400,
        "INVALID_WORKFLOW_PROMPTS",
        "每个阶段 Prompt 需为 20–12000 个字符",
      );
    prompts[key] = text.trim();
  }
  return prompts;
}
export class WorkflowConfigurationStore {
  constructor(
    readonly source: DataSource,
    private readonly cache = new ConfigurationCache(),
  ) {}
  defaults() {
    return structuredClone(defaultWorkflowPrompts);
  }
  async snapshot(): Promise<AgentWorkflowConfiguration> {
    const [state] = await this.source.query(
      "SELECT revision FROM ai_workflow_settings WHERE id=1",
    );
    if (!state)
      throw new ApiError(
        503,
        "WORKFLOW_CONFIG_REQUIRED",
        "请先初始化分析流程数据库",
      );
    return this.cache.read("workflow", Number(state.revision), () =>
      this.load(Number(state.revision)),
    );
  }
  private async load(revision: number): Promise<AgentWorkflowConfiguration> {
    const [row] = await this.source.query(
      `SELECT revision,prompts_json,created_at FROM ai_workflow_configurations WHERE revision=?`,
      [revision],
    );
    if (!row)
      throw new ApiError(
        503,
        "WORKFLOW_CONFIG_REQUIRED",
        "分析流程尚未初始化，请执行数据库初始化",
      );
    return {
      revision: Number(row.revision),
      prompts: parseWorkflowPrompts(
        typeof row.prompts_json === "string"
          ? JSON.parse(row.prompts_json)
          : row.prompts_json,
      ),
      updatedAt: new Date(row.created_at).toISOString(),
    };
  }
  async save(
    value: unknown,
    administratorId: string,
  ): Promise<AgentWorkflowConfiguration> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ApiError(400, "INVALID_WORKFLOW_PROMPTS", "配置格式不正确");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((k) => !["revision", "prompts"].includes(k)))
      throw new ApiError(400, "INVALID_WORKFLOW_PROMPTS", "配置存在未知字段");
    const prompts = parseWorkflowPrompts(input.prompts);
    const revision = await this.source.transaction(async (db) => {
      const [current] = await db.query(
        "SELECT revision FROM ai_workflow_settings WHERE id=1 FOR UPDATE",
      );
      if (!current || input.revision !== Number(current.revision))
        throw new ApiError(
          409,
          "WORKFLOW_CONFIG_CHANGED",
          "配置已更新，请刷新后再保存",
        );
      const next = Number(current.revision) + 1;
      await db.query(
        "INSERT INTO ai_workflow_configurations(revision,prompts_json,administrator_id) VALUES(?,?,?)",
        [next, JSON.stringify(prompts), administratorId],
      );
      await db.query("UPDATE ai_workflow_settings SET revision=? WHERE id=1", [
        next,
      ]);
      return next;
    });
    const [row] = await this.source.query(
      "SELECT created_at FROM ai_workflow_configurations WHERE revision=?",
      [revision],
    );
    return {
      revision,
      prompts,
      updatedAt: new Date(row.created_at).toISOString(),
    };
  }
}
