/** Transport contracts only: no provider SDK, UI component or server dependency. */
import type { Resource } from "./resources.js";
import type { ResourceRef, ApplicationDestination } from "@t-box/app-contracts";
export type ApplicationId = string;
export type ChatMode = "unconfigured" | "openai";
export type ToolExecution = "server" | "client";
export type ToolStatus = "running" | "waiting_client" | "completed" | "failed";

/** Application-declared public output preview; contains no prompt or provider details. */
export interface ToolOutputPreview {
  kind: "image";
  width: number;
  height: number;
  label: string;
}

export interface ToolCallView {
  id: string;
  name: string;
  title: string;
  execution: ToolExecution;
  status: ToolStatus;
  summary?: string;
  preview?: ToolOutputPreview;
}

export type TimelineTextKind = "reasoning" | "analysis" | "answer" | "notice";
export type TimelineTextStatus = "streaming" | "completed" | "interrupted";
interface TimelineBase {
  id: string;
  sequence: number;
  revision: number;
  createdAt: string;
  agentId?: string;
  agentTitle?: string;
}
/** Public progress only; no raw reasoning, arguments or private interaction payloads. */
export type ChatTimelineItem =
  | (TimelineBase & {
      kind: TimelineTextKind;
      text: string;
      label?: string;
      status: TimelineTextStatus;
    })
  | (TimelineBase & { kind: "tool"; tool: ToolCallView });

export interface ModelUsage {
  id: string;
  agentId?: string;
  purpose: import("./agent-workflow.js").ModelCallPurpose;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens: number | null;
  totalTokens: number;
  durationMs: number;
}
export interface MessageUsage {
  calls: ModelUsage[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  execution?: MessageExecution;
  answerRevision?: number;
  localDate?: string;
  error?: { code: string; message: string; retryable: boolean };
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolCalls: ToolCallView[];
  attachments?: Resource[];
  resourceRefs?: ResourceRef[];
  applicationIds?: ApplicationId[];
  timeline?: ChatTimelineItem[];
  usage?: MessageUsage;
  outcome?: "running" | "completed" | "paused" | "cancelled" | "failed";
}

/** Accumulated execution time. Paused intervals do not accrue time. */
export interface MessageExecution {
  startedAt: string;
  durationMs: number;
  activeSince?: string;
  finishedAt?: string;
}

export interface ChatRun {
  id: string;
  requestId: string;
  assistantMessageId: string;
  status: "running" | "waiting_client";
  agentId?: string;
  agentTitle?: string;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_client"
  | "paused"
  | "needs_review"
  | "completed"
  | "cancelled";
export interface TaskSummary {
  protectedResources?: ResourceRef[];
  unavailable?: boolean;
  id: string;
  conversationId: string;
  status: TaskStatus;
  agentId: string;
  updatedAt: string;
  reason?: string;
  title?: string;
  agentTitle?: string;
}
export interface TaskToolRecord {
  callId: string;
  name: string;
  agentId: string;
  effect: string;
  status: "dispatched" | "completed" | "uncertain";
  result?: ToolResult;
}

export interface ConversationBranch {
  sourceConversationId: string;
  sourceMessageId: string;
}

export interface ChatSnapshot {
  conversationRevision?: number;
  branch?: ConversationBranch;
  sessionId: string;
  mode: ChatMode;
  messages: ChatMessage[];
  activeRun: ChatRun | null;
  conversationId?: string;
  task?: TaskSummary | null;
  title?: string;
}

export type ToolResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: { code: string; message: string } };

export type OpenAppArguments = ApplicationDestination;

export type ChatClientEvent =
  | {
      type: "session.open";
      sessionId?: string;
      token?: string;
      authToken?: string;
      conversationId?: string;
      clientCapabilities?: string[];
    }
  | {
      type: "message.send";
      requestId: string;
      text: string;
      localDate: string;
      scopeBindings?: ResourceRef[];
      attachmentIds?: string[];
      applicationIds?: ApplicationId[];
    }
  | {
      type: "message.resend";
      requestId: string;
      sourceMessageId: string;
      expectedRevision?: number;
      text: string;
      localDate: string;
      scopeBindings?: ResourceRef[];
      attachmentIds?: string[];
      applicationIds?: ApplicationId[];
    }
  | {
      type: "message.retry";
      requestId: string;
      messageId: string;
      expectedRevision?: number;
    }
  | {
      type: "message.delete";
      requestId: string;
      messageId: string;
      expectedRevision?: number;
    }
  | { type: "tool.result"; runId: string; callId: string; result: ToolResult }
  | { type: "run.cancel"; runId: string }
  | { type: "task.resume"; taskId: string }
  | { type: "task.cancel"; taskId: string }
  | { type: "ping" };

export type ChatServerEvent =
  | {
      type: "message.deleted";
      requestId: string;
      messageIds: string[];
      snapshot: ChatSnapshot;
    }
  | {
      type: "session.ready";
      snapshot: ChatSnapshot;
      token: string;
      restored: boolean;
    }
  | { type: "session.snapshot"; snapshot: ChatSnapshot }
  | { type: "runtime.configuration"; maxMessageLength: number }
  | { type: "agent.changed"; runId: string; agentId: string; title: string }
  | {
      type: "run.started";
      run: ChatRun;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }
  | {
      type: "message.usage";
      runId: string;
      messageId: string;
      usage: MessageUsage;
    }
  | { type: "assistant.delta"; runId: string; messageId: string; delta: string }
  | {
      type: "assistant.replace";
      runId: string;
      messageId: string;
      content: string;
    }
  | {
      type: "timeline.update";
      runId: string;
      messageId: string;
      item: ChatTimelineItem;
    }
  | {
      type: "timeline.delta";
      runId: string;
      messageId: string;
      itemId: string;
      revision: number;
      delta: string;
    }
  | { type: "conversation.title"; conversationId: string; title: string }
  | {
      type: "tool.update";
      runId: string;
      messageId: string;
      tool: ToolCallView;
      attachments?: Resource[];
    }
  | {
      type: "tool.request";
      runId: string;
      callId: string;
      name: string;
      arguments: unknown;
    }
  | {
      type: "run.finished";
      runId: string;
      status: "completed" | "cancelled" | "failed" | "paused";
      snapshot: ChatSnapshot;
    }
  | {
      type: "error";
      code: string;
      message: string;
      requestId?: string;
      resourceRefs?: ResourceRef[];
    }
  | { type: "pong" };

export const CHAT_LIMITS = {
  maxMessageLength: 2_000,
  maxToolRounds: 8,
  clientToolTimeoutMs: 120_000,
  runTimeoutMs: 300_000,
} as const;
