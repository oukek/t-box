import type { ChatMessage, TaskSummary } from "@t-box/shared";
/** A suspended task is an optional continuation, never a permanent composer lock. */
export function taskBlocksNewMessage(
  task?: Pick<TaskSummary, "status"> | null,
) {
  return !!task && ["running", "queued"].includes(task.status);
}
export function hasFinishedReply(
  messages: readonly Pick<ChatMessage, "id" | "role" | "outcome">[],
  userId: string,
) {
  const index = messages.findIndex((m) => m.id === userId && m.role === "user");
  const answer = messages[index + 1];
  return (
    index >= 0 && answer?.role === "assistant" && answer.outcome !== "running"
  );
}

/** Copy the final answer's Markdown, without the analysis or tool execution timeline. */
export function answerCopyText(message: {
  content: string;
  timeline?: readonly { sequence: number; kind: string; text?: string }[];
}): string {
  const answers = [...(message.timeline || [])]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((item) => item.kind === "answer");
  return answers.length
    ? answers
        .map((item) => item.text || "")
        .join("\n\n")
        .trim()
    : message.content.trim();
}
