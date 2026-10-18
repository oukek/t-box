import type {
  AgentWorkflowConfiguration,
  AgentWorkflowPrompts,
} from '@t-box/shared'
import type { DataSource } from 'typeorm'
import { isoTime } from '@t-box/server-foundation/time'
import { ConfigurationCache } from '../configuration/cache.js'
import {
  AiWorkflowConfigurationEntity,
  AiWorkflowSettingEntity,
} from '../db/records/workflow-entities.js'
import { ErrorCode } from '../error-codes.js'
import { defaultWorkflowPrompts } from './defaults.js'

export function parseWorkflowPrompts(value: unknown): AgentWorkflowPrompts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ErrorCode.INVALID_WORKFLOW_PROMPTS()
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).some(
      (key) => !Object.hasOwn(defaultWorkflowPrompts, key),
    )
  ) {
    throw ErrorCode.INVALID_WORKFLOW_PROMPTS('存在未知阶段')
  }
  const prompts = {} as AgentWorkflowPrompts
  for (const key of Object.keys(
    defaultWorkflowPrompts,
  ) as (keyof AgentWorkflowPrompts)[]) {
    const text = input[key]
    if (
      typeof text !== 'string' ||
      text.trim().length < 20 ||
      text.length > 12000
    ) {
      throw ErrorCode.INVALID_WORKFLOW_PROMPTS(
        '每个阶段 Prompt 需为 20–12000 个字符',
      )
    }
    prompts[key] = text.trim()
  }
  return prompts
}
export class WorkflowConfigurationStore {
  constructor(
    readonly source: DataSource,
    private readonly cache = new ConfigurationCache(),
  ) {}

  defaults() {
    return structuredClone(defaultWorkflowPrompts)
  }

  async snapshot(): Promise<AgentWorkflowConfiguration> {
    const state = await this.source
      .getRepository(AiWorkflowSettingEntity)
      .findOne({ select: { revision: true }, where: { id: 1 } })
    if (!state) {
      throw ErrorCode.WORKFLOW_CONFIG_REQUIRED()
    }
    return this.cache.read('workflow', Number(state.revision), () =>
      this.load(Number(state.revision)))
  }

  private async load(revision: number): Promise<AgentWorkflowConfiguration> {
    const row = await this.source
      .getRepository(AiWorkflowConfigurationEntity)
      .findOne({
        select: { revision: true, prompts_json: true, created_at: true },
        where: { revision },
      })
    if (!row) {
      throw ErrorCode.WORKFLOW_CONFIG_REQUIRED(
        '分析流程尚未初始化，请执行数据库初始化',
      )
    }
    return {
      revision: Number(row.revision),
      prompts: parseWorkflowPrompts(
        typeof row.prompts_json === 'string'
          ? JSON.parse(row.prompts_json)
          : row.prompts_json,
      ),
      updatedAt: isoTime(row.created_at),
    }
  }

  async save(
    value: unknown,
    administratorId: string,
  ): Promise<AgentWorkflowConfiguration> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw ErrorCode.INVALID_WORKFLOW_PROMPTS('配置格式不正确')
    }
    const input = value as Record<string, unknown>
    if (Object.keys(input).some((k) => !['revision', 'prompts'].includes(k))) {
      throw ErrorCode.INVALID_WORKFLOW_PROMPTS('配置存在未知字段')
    }
    const prompts = parseWorkflowPrompts(input.prompts)
    const revision = await this.source.transaction(async (db) => {
      const current = await db.getRepository(AiWorkflowSettingEntity).findOne({
        select: { revision: true },
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      })
      if (!current || input.revision !== Number(current.revision)) {
        throw ErrorCode.WORKFLOW_CONFIG_CHANGED()
      }
      const next = Number(current.revision) + 1
      await db.getRepository(AiWorkflowConfigurationEntity).insert({
        revision: next,
        prompts_json: prompts,
        administrator_id: administratorId,
      })
      await db
        .getRepository(AiWorkflowSettingEntity)
        .update({ id: 1 }, { revision: next })
      return next
    })
    const row = await this.source
      .getRepository(AiWorkflowConfigurationEntity)
      .findOne({ select: { created_at: true }, where: { revision } })
    if (!row) {
      throw ErrorCode.SCHEMA_REQUIRED('工作流配置记录不存在')
    }
    return {
      revision,
      prompts,
      updatedAt: isoTime(row.created_at),
    }
  }
}
