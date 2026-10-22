import type { ChatMessage, TaskWorkingMemory } from '@t-box/shared'
import type { AgentFrame } from './checkpoint.js'
/** Deterministic projection of verified execution state, not another paid planning pass. */
export function workingMemory(
  frame: AgentFrame,
  message: ChatMessage,
  request: ChatMessage | undefined,
): TaskWorkingMemory {
  const own = new Set(frame.receiptIds || [])
  return {
    version: 1,
    requestMessageId: request?.id ?? '',
    goal: (frame.workingMemory?.goal || request?.content || '').slice(0, 800),
    phase: frame.workflow?.phase ?? 'execution',
    plannedSteps: frame.workflow?.plan?.steps.slice(0, 12) ?? [],
    completedCallIds: message.toolCalls
      .filter((tool) => own.has(tool.id) && tool.status === 'completed')
      .map((tool) => tool.id)
      .slice(-32),
    pendingCallNames: frame.calls.map((call) => call.name).slice(0, 8),
  }
}
