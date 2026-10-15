import type { ChatSession } from '../chat/session.js'
import type { Actor, AgentRuntimeOptions } from './contracts.js'
import type { AgentRunInput } from './runner.js'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  closeInterruptedHistory,
} from './checkpoint.js'
import { prepareTaskResume } from './resume.js'
import { object, parseIdentifier } from './schema.js'
import { authorizedSnapshot } from './snapshot.js'

const fail = (code: string, message: string): never => {
  throw new ApiError(400, code, message)
}
/** Transport-independent commands for durable task ownership, compatibility and resume. */
export async function handleTaskCommand(
  options: AgentRuntimeOptions,
  current: ChatSession,
  principal: Actor | undefined,
  event: Record<string, unknown>,
  isConnected: () => boolean,
  launch: (input: AgentRunInput) => void,
): Promise<void> {
  if (event.type === 'task.cancel') {
    object(event, ['type', 'taskId'])
    const taskId = parseIdentifier(event.taskId)
    if (!principal || !options.host?.tasks) {
      fail('TASKS_UNAVAILABLE', '持久任务服务不可用')
    }
    await options.host!.identity.authenticateHash(principal!.sessionHash)
    await options.host!.tasks!.cancel(principal!, taskId)
    if (current.active?.view.id === taskId) {
      current.active.abort.abort('CANCELLED')
    } else if (
      current.task?.id === taskId &&
      !current.active &&
      current.task.status !== 'running'
    ) {
      closeInterruptedHistory(current)
      current.history.push({
        role: 'assistant',
        content: '任务已结束。已完成操作保留，不自动重复执行。',
      })
      await options.host!.conversations?.save(current)
    }
    current.task = current.conversationId
      ? await options.host!.tasks!.current(principal!, current.conversationId)
      : null
    current.send?.({
      type: 'session.snapshot',
      snapshot: await authorizedSnapshot(
        options,
        current,
        options.provider.mode,
        principal,
      ),
    })
    return
  }
  if (event.type === 'task.resume') {
    object(event, ['type', 'taskId'])
    if (!principal || !options.host?.tasks) {
      fail('TASKS_UNAVAILABLE', '持久任务服务不可用')
    }
    const input = await prepareTaskResume(options, current, principal!, parseIdentifier(event.taskId))
    if (isConnected()) {
      launch(input)
    }
  }
}
