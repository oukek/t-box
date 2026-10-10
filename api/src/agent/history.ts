import type { ChatSession } from "../chat/session.js";
import type { CapabilityRegistry } from "./registry.js";
import type { AttachmentPort } from "./contracts.js";
import type { ProviderItem } from "../chat/provider.js";
/** Rehydrate portable history without treating visible candidate text as evidence of successful writes. */
export function rebuildConversationHistory(
  session: ChatSession,
  registry: CapabilityRegistry,
  attachments?: AttachmentPort,
): ProviderItem[] {
  const history: ProviderItem[] = session.branch?.executionContext
    ? [{ role: "assistant", content: session.branch.executionContext }]
    : [];
  for (const message of session.messages) {
    if (message.role === "assistant") {
      const tools = new Map(
        [
          ...(session.answerRetryEvidence?.[message.id]?.toolCalls || []),
          ...message.toolCalls,
        ].map((tool) => [tool.id, tool]),
      );
      for (const tool of tools.values()) {
        const stored = session.calls.get(tool.id);
        const colon = stored?.fingerprint.indexOf(":") ?? -1;
        const name =
          colon >= 0 ? stored!.fingerprint.slice(0, colon) : tool.name;
        const args = colon >= 0 ? stored!.fingerprint.slice(colon + 1) : "{}";
        history.push(
          { type: "function_call", call_id: tool.id, name, arguments: args },
          {
            type: "function_call_output",
            call_id: tool.id,
            output: JSON.stringify(
              stored?.result ?? {
                ok: false,
                error: {
                  code: "RESULT_UNAVAILABLE",
                  message: "缺少完整回执，请先核对，不得自动重做操作。",
                },
              },
            ),
          },
        );
      }
    }
    const text = registry.messageText(message);
    if (text || message.role === "user")
      history.push({ role: message.role, content: text });
    if (message.role === "user")
      attachments?.append(history, text, message.attachments || []);
  }
  return history;
}
