import type { ChatMessage, MessageExecution } from "@t-box/shared";

/** Restart from the last saved duration, never count an unknown offline/paused interval. */
export function startExecution(message: ChatMessage, now = Date.now()) {
  const timestamp = new Date(now).toISOString();
  message.execution = {
    startedAt: message.execution?.startedAt || timestamp,
    durationMs: message.execution?.durationMs || 0,
    activeSince: timestamp,
  };
}
export function checkpointExecution(message: ChatMessage, now = Date.now()) {
  const execution = message.execution;
  if (!execution?.activeSince) return;
  execution.durationMs += Math.max(0, now - Date.parse(execution.activeSince));
  execution.activeSince = new Date(now).toISOString();
}
export function finishExecution(
  message: ChatMessage,
  now = Date.now(),
): MessageExecution | undefined {
  checkpointExecution(message, now);
  if (message.execution) {
    delete message.execution.activeSince;
    message.execution.finishedAt = new Date(now).toISOString();
  }
  return message.execution;
}
