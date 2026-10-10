import type { ChatMode, ChatSnapshot } from '@t-box/shared'
import type { ChatSession } from '../chat/session.js'
import type { Actor, AgentRuntimeOptions } from './contracts.js'
import { snapshot } from '../chat/session.js'
/** A failed/expired history grant must never reveal staged private history through the final WS snapshot. */
export async function authorizedSnapshot(
  options: AgentRuntimeOptions,
  session: ChatSession,
  mode: ChatMode,
  actor?: Actor,
): Promise<ChatSnapshot> {
  if (!actor) {
    return snapshot(session, mode)
  }
  try {
    await options.host?.identity.authenticateHash(actor.sessionHash)
    await options.registry.access.history(actor, session.messages)
    if (
      session.archived &&
      session.conversationId &&
      options.host?.conversations?.getTitle
    ) {
      session.title = await options.host.conversations.getTitle(
        actor,
        session.conversationId,
      )
    }
    return snapshot(session, mode)
  } catch {
    const value = snapshot(session, mode)
    value.title = '受保护的会话'
    value.messages = value.messages.map((message) => ({
      ...message,
      content: '此会话包含受保护的资源，请重新授权后打开。',
      toolCalls: [],
      timeline: [],
      usage: undefined,
      attachments: [],
    }))
    return value
  }
}
