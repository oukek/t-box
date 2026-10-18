import type { ChatSession } from '../chat/session.js'
import type { RunCheckpoint } from './checkpoint.js'
import type { Actor, AgentRuntimeOptions } from './contracts.js'
import type { AgentRunInput } from './runner.js'
import { ErrorCode } from '../error-codes.js'
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
    throw ErrorCode.TASKS_UNAVAILABLE()
  }
  if (current.active || current.finishing) {
    throw ErrorCode.RUN_IN_PROGRESS.conflict()
  }
  await host.identity.authenticateHash(principal.sessionHash)
  const task = await host.tasks.get(principal, taskId)
  if (task.summary.conversationId !== current.conversationId) {
    throw ErrorCode.TASK_CONVERSATION_MISMATCH()
  }
  if (!['queued', 'paused', 'waiting_client'].includes(task.summary.status)) {
    throw ErrorCode.TASK_NOT_RESUMABLE()
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
    throw ErrorCode.TASK_VERSION_MISMATCH()
  }
  if (
    checkpoint.modulePins
      ? Object.entries(checkpoint.modulePins).some(
          ([id, pin]) => options.registry.moduleRevision(id) !== pin.revision,
        )
      : checkpoint.registryRevision !== options.registry.revision
  ) {
    throw ErrorCode.TASK_CAPABILITIES_CHANGED()
  }
  await options.registry.access.history(principal, checkpoint.session.messages)
  if (
    host.conversations &&
    !(await host.conversations.exists(principal, task.summary.conversationId))
  ) {
    if (current.archived) {
      throw ErrorCode.CONVERSATION_NOT_FOUND('会话已删除，不能继续任务')
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
    ? await options.provider.forRun({
        configurationKey: checkpoint.session.configurationKey,
      })
    : options.provider
  if (provider.mode === 'unconfigured') {
    throw ErrorCode.AI_NOT_CONFIGURED.invalid()
  }
  if (checkpoint.session.configurationKey !== provider.configurationKey) {
    throw ErrorCode.TASK_MODEL_CHANGED(
      '任务使用的模型配置已改变，请恢复原配置或核对后结束任务',
    )
  }
  if (current.active || current.finishing) {
    throw ErrorCode.RUN_IN_PROGRESS.conflict('当前任务尚未结束')
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
