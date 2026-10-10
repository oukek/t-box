import type { ChatMessage, ToolResult } from "@t-box/shared";
import { ApiError } from "@t-box/server-foundation/errors";
import type { AgentRuntimeOptions } from "../agent/contracts.js";
import { rebuildConversationHistory } from "../agent/history.js";
import type { ChatSession } from "./session.js";
import { messagePair } from "./message-commands.js";

export function retryPair(session: ChatSession, id: string) {
  const pair = messagePair(session.messages, id);
  const answer = pair.messages.find(
    (m) => m.id === id && m.role === "assistant",
  );
  if (!answer || pair.messages.length !== 2)
    throw new ApiError(400, "MESSAGE_ROLE_INVALID", "请选择需要重试的回答");
  return { ...pair, user: pair.messages[0]!, answer };
}

/** Isolate regeneration input from later turns, while retaining actual tool receipts. */
export function prepareAnswerRetry(
  options: AgentRuntimeOptions,
  session: ChatSession,
  assistantId: string,
  requestId: string,
) {
  const pair = retryPair(session, assistantId);
  const original = structuredClone(pair.answer);
  // The original side-effect receipts survive every regeneration, even if a later answer calls no tools.
  if (!session.answerRetryEvidence?.[assistantId]) {
    const tools = original.toolCalls.filter((t) => {
      const effect = options.registry.tools[t.name]?.effect;
      return !effect || ["write", "external"].includes(effect);
    });
    const ids = new Set(tools.map((t) => t.id));
    session.answerRetryEvidence = {
      ...session.answerRetryEvidence,
      [assistantId]: {
        toolCalls: structuredClone(tools),
        calls: structuredClone(
          [...session.calls].filter(([id]) => ids.has(id)),
        ),
      },
    };
  }
  const callIds = new Set(original.toolCalls.map((t) => t.id));
  session.pendingAnswerVersion = {
    requestId,
    message: original,
    calls: structuredClone(
      [...session.calls].filter(([id]) => callIds.has(id)),
    ),
  };
  const replacement: ChatMessage = {
    id: original.id,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    answerRevision: (original.answerRevision || 0) + 1,
    toolCalls: [],
    attachments: original.attachments,
    resourceRefs: options.registry.access.references(pair.messages),
  };
  session.messages[pair.start + 1] = replacement;
  session.history = rebuildConversationHistory(
    {
      ...session,
      messages: [
        ...session.messages.slice(0, pair.start + 1),
        { ...original, content: "", timeline: [] },
      ],
    },
    options.registry,
    options.host?.attachments,
  );
  session.history.push({
    role: "assistant",
    content:
      "请重新回答最后一个用户问题。前述工具回执是已经发生的事实，重试不会撤销旧操作。允许查询核对数据；仅可复用旧写入或外部操作的回执，不得产生新的写入、生成或外部副作用。缺少明确成功回执的操作需要核对，不能宣称已成功。旧回答及后续问答不会作为此次回答的内容依据。",
  });
  session.contextState = {};
  const writes = new Map<string, ToolResult>();
  for (const [, stored] of session.answerRetryEvidence[assistantId]!.calls) {
    const colon = stored.fingerprint.indexOf(":"),
      name = stored.fingerprint.slice(0, colon);
    const tool = options.registry.tools[name];
    if (!tool || !["write", "external"].includes(tool.effect)) continue;
    try {
      const args = JSON.parse(stored.fingerprint.slice(colon + 1));
      const key = `${name}:${tool.writeFingerprint ? tool.writeFingerprint(args) : JSON.stringify(args)}`;
      writes.set(key, stored.result);
    } catch {
      /* Unparseable old arguments cannot authorize a new side effect. */
    }
  }
  return { user: pair.user, assistant: replacement, writes: [...writes] };
}
