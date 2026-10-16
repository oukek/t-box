import type { ChatSession } from '../chat/session.js'
import type { RunCheckpoint } from './checkpoint.js'
import type { Actor, AgentRuntimeOptions } from './contracts.js'
import type { AgentRunInput } from './runner.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { restoreCheckpoint } from './checkpoint.js'

/** Both user and background resumption pass exactly the same compatibility and access checks. */
export async function prepareTaskResume(
  options: AgentRuntimeOptions,
  current: ChatSession,
  principal: Actor,
  taskId: string,
): Promise<AgentRunInput> {
  const host = options.host
  if (!host?.tasks) {
    throw new ApiError(400, 'TASKS_UNAVAILABLE', '持久任务服务不可用')
  }
  if (current.active || current.finishing) {
    throw new ApiError(409, 'RUN_IN_PROGRESS', '请等待当前任务结束')
  }
  await host.identity.authenticateHash(principal.sessionHash)
  const task = await host.tasks.get(principal, taskId)
  if (task.summary.conversationId !== current.conversationId) {
    throw new ApiError(
      400,
      'TASK_CONVERSATION_MISMATCH',
      '请打开此任务所属会话后继续',
    )
  }
  if (!['queued', 'paused', 'waiting_client'].includes(task.summary.status)) {
    throw new ApiError(
      409,
      'TASK_NOT_RESUMABLE',
      '此任务不能继续，结果不确定的操作请先核对',
    )
  }
  const checkpoint = task.checkpoint as RunCheckpoint
  if (
    checkpoint.version !== 1 ||
    checkpoint.runId !== task.summary.id ||
    !checkpoint.frames?.length ||
    !checkpoint.session?.messages?.some(
      (message) => message.id === checkpoint.assistantId,
    )
  ) {
    throw new ApiError(
      409,
      'TASK_VERSION_MISMATCH',
      '任务格式不兼容，请核对后结束任务',
    )
  }
  if (
    checkpoint.modulePins
      ? Object.entries(checkpoint.modulePins).some(
          ([id, pin]) => options.registry.moduleRevision(id) !== pin.revision,
        )
      : checkpoint.registryRevision !== options.registry.revision
  ) {
    throw new ApiError(
      409,
      'TASK_CAPABILITIES_CHANGED',
      '任务的应用或技能版本已改变，请核对后结束旧任务',
    )
  }
  await options.registry.access.history(principal, checkpoint.session.messages)
  if (
    host.conversations &&
    !(await host.conversations.exists(principal, task.summary.conversationId))
  ) {
    if (current.archived) {
      throw new ApiError(
        404,
        'CONVERSATION_NOT_FOUND',
        '会话已删除，不能继续任务',
      )
    }
    current.finishing = true
    try {
      restoreCheckpoint(current, checkpoint)
      await host.conversations.save(current)
    } finally {
      current.finishing = false
    }
  }
  for (const ref of options.registry.access.parse(checkpoint.bindings)) {
    await options.registry.access.inspect(principal, ref, 'read', '继续任务')
  }
  const provider = options.provider.forRun
    ? await options.provider.forRun({ configurationKey: checkpoint.session.configurationKey })
    : options.provider
  if (provider.mode === 'unconfigured') {
    throw new ApiError(
      400,
      'AI_NOT_CONFIGURED',
      '尚未接入 AI，请在后台配置普通会话模型',
    )
  }
  if (checkpoint.session.configurationKey !== provider.configurationKey) {
    throw new ApiError(
      409,
      'TASK_MODEL_CHANGED',
      '任务使用的模型配置已改变，请恢复原配置或核对后结束任务',
    )
  }
  if (current.active || current.finishing) {
    throw new ApiError(409, 'RUN_IN_PROGRESS', '当前任务尚未结束')
  }
  return {
    session: current,
    requestId: checkpoint.requestId,
    text: '',
    localDate: checkpoint.localDate,
    principal,
    bindings: checkpoint.bindings,
    attachments: [],
    provider,
    applicationIds: checkpoint.applicationIds,
    resume: checkpoint,
  }
}
