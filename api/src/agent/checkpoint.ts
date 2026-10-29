import type { ChatMessage, ResourceRef, ToolResult } from '@t-box/shared'
import type { ModelCall, ProviderItem } from '../chat/provider.js'
import type { ChatSession } from '../chat/session.js'

export interface AgentFrame {
  workingMemory?: import('@t-box/shared').TaskWorkingMemory
  memoryIds?: string[]
  capabilities?: import('./capability-loading.js').CapabilitySelection
  discoveryRounds?: number
  modelRequests?: Record<string, import('./model-retry.js').ModelRequestRecord>
  /** Stable across compaction/model changes so failover cannot reset the retry budget. */
  modelRequestKey?: string
  modelFailover?: {
    pending: boolean
    modelIds: string[]
    providerIds: string[]
  }
  workflow?: import('./workflow.js').FrameWorkflow
  contextState?: import('./context.js').ContextState
  /** Receipt ownership survives provider-history compaction. */
  receiptIds?: string[]
  agentId: string
  history: ProviderItem[]
  skills: string[]
  rounds: number
  calls: ModelCall[]
  content: string
  done: boolean
  parentCallId?: string
}
export interface RunCheckpoint {
  useMemory?: boolean
  /** Absent on old checkpoints: resume their existing eager tool protocol. */
  capabilityLoading?: 'deferred'
  configuration?: import('@t-box/shared').ConfigurationSnapshot
  execution?: import('@t-box/shared').MessageExecution
  retry?: { assistantId: string }
  version: 1
  workflow?: import('@t-box/shared').AgentWorkflowConfiguration
  /** New tasks can answer in their first call; old checkpoints retain their phase protocol. */
  workflowEntry?: 'adaptive'
  registryRevision: string
  modulePins?: Record<string, { revision: string, installation: string }>
  runId: string
  requestId: string
  localDate: string
  applicationIds: string[]
  bindings: ResourceRef[]
  assistantId: string
  totalRounds: number
  delegations: number
  frames: AgentFrame[]
  writes: [string, ToolResult][]
  session: {
    answerRetryEvidence?: ChatSession['answerRetryEvidence']
    pendingAnswerVersion?: ChatSession['pendingAnswerVersion']
    branch?: ChatSession['branch']
    messageCommands?: ChatSession['messageCommands']
    contextState?: ChatSession['contextState']
    messages: ChatMessage[]
    requests: [string, unknown][]
    calls: [string, unknown][]
    configurationKey?: string
    mode?: ChatSession['mode']
  }
}
export function captureSession(session: ChatSession): RunCheckpoint['session'] {
  return {
    answerRetryEvidence: session.answerRetryEvidence,
    pendingAnswerVersion: session.pendingAnswerVersion,
    branch: session.branch,
    messageCommands: session.messageCommands,
    contextState: session.contextState,
    messages: session.messages,
    requests: [...session.requests],
    calls: [...session.calls],
    configurationKey: session.configurationKey,
    mode: session.mode,
  }
}
export function restoreCheckpoint(
  session: ChatSession,
  checkpoint: RunCheckpoint,
) {
  Object.assign(session, checkpoint.session, {
    requests: new Map(checkpoint.session.requests) as ChatSession['requests'],
    calls: new Map(checkpoint.session.calls) as ChatSession['calls'],
    scopeBindings: checkpoint.bindings,
    history: checkpoint.frames[0]!.history,
    contextState:
      checkpoint.frames[0]!.contextState ?? checkpoint.session.contextState,
  })
  delete session.rebuildHistory
}
/** Terminal interruption must leave complete call/output pairs for the next user turn. */
export function closeInterruptedHistory(session: ChatSession) {
  const completed = new Set(
    session.history.flatMap((item) =>
      item.type === 'function_call_output' ? [item.call_id] : [],
    ),
  )
  const calls = session.history.filter((item) => item.type === 'function_call')
  for (const call of calls) {
    if (call.type === 'function_call' && !completed.has(call.call_id)) {
      session.history.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify({
          ok: false,
          error: {
            code: 'RUN_INTERRUPTED',
            message: '此任务已结束，请核对已完成的工具记录，不自动重试。',
          },
        }),
      })
      completed.add(call.call_id)
    }
  }
  for (const message of session.messages) {
    if (message.outcome === 'running' || message.outcome === 'paused') {
      message.outcome = 'cancelled'
    }
    for (const tool of message.toolCalls) {
      if (['running', 'waiting_client'].includes(tool.status)) {
        tool.status = 'failed'
        tool.summary = '任务已结束，请核对已完成的操作'
      }
    }
    for (const item of message.timeline || []) {
      if (item.kind === 'tool') {
        const tool = message.toolCalls.find((x) => x.id === item.tool.id)
        if (tool) {
          item.tool = { ...tool }
        }
      } else if (item.status === 'streaming') {
        item.status = 'interrupted'
      }
      item.revision++
    }
  }
}
