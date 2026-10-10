import test from "node:test";
import assert from "node:assert/strict";
import type { ChatSnapshot, TaskSummary } from "@t-box/shared";
import { ClientTaskRecovery } from "../src/features/chat/taskRecovery.js";
const task = (status: TaskSummary["status"]): TaskSummary => ({
  id: "task",
  conversationId: "conversation",
  agentId: "assistant",
  updatedAt: "now",
  status,
});
const snapshot = (status: TaskSummary["status"]): ChatSnapshot => ({
  sessionId: "session",
  mode: "openai",
  messages: [],
  activeRun: null,
  task: task(status),
});
test("reopened waiting task resumes once without resending a user message or approving anything", () => {
  const recovery = new ClientTaskRecovery();
  recovery.open(snapshot("waiting_client"));
  assert.equal(recovery.take(task("waiting_client"), true), false);
  assert.equal(recovery.take(task("waiting_client"), false), true);
  assert.equal(recovery.take(task("waiting_client"), false), false);
  recovery.open(snapshot("waiting_client"));
  assert.equal(recovery.take(task("waiting_client"), false), true);
});
test("reconnection during pause finalization waits for the backend then recovers its UI boundary", () => {
  const recovery = new ClientTaskRecovery();
  recovery.open(snapshot("running"));
  assert.equal(recovery.take(task("running"), false), false);
  assert.equal(recovery.take(task("waiting_client"), false), true);
});
test("model failures, uncertain effects, cancellations and other conversations never auto resume", () => {
  const recovery = new ClientTaskRecovery();
  for (const status of [
    "queued",
    "paused",
    "needs_review",
    "completed",
    "cancelled",
  ] as const) {
    recovery.open(snapshot(status));
    assert.equal(recovery.take(task(status), false), false);
  }
  recovery.open(snapshot("waiting_client"));
  assert.equal(
    recovery.take({ ...task("waiting_client"), id: "other" }, false),
    false,
  );
  recovery.clear();
  assert.equal(recovery.take(task("waiting_client"), false), false);
});
