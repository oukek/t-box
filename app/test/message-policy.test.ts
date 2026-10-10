import test from "node:test";
import assert from "node:assert/strict";
import {
  taskBlocksNewMessage,
  hasFinishedReply,
  answerCopyText,
} from "../src/features/chat/messagePolicy.js";
test("suspended, failed-review and completed tasks never permanently disable the composer", () => {
  for (const status of [
    "paused",
    "waiting_client",
    "needs_review",
    "completed",
    "cancelled",
  ] as const)
    assert.equal(taskBlocksNewMessage({ status }), false);
  for (const status of ["running", "queued"] as const)
    assert.equal(taskBlocksNewMessage({ status }), true);
  assert.equal(taskBlocksNewMessage(null), false);
});
test("copy extracts ordered final Markdown and excludes analysis/tool execution content", () => {
  assert.equal(
    answerCopyText({
      content: "兼容回答",
      timeline: [
        { sequence: 4, kind: "answer", text: "第二段" },
        { sequence: 1, kind: "analysis", text: "不复制的分析" },
        { sequence: 2, kind: "tool" },
        { sequence: 3, kind: "answer", text: "**第一段**" },
      ],
    }),
    "**第一段**\n\n第二段",
  );
  assert.equal(answerCopyText({ content: "  历史回答  " }), "历史回答");
});
test("message actions wait for the paired reply to finish, including failures", () => {
  const user = { id: "u", role: "user" as const };
  for (const outcome of [
    "completed",
    "failed",
    "paused",
    "cancelled",
    undefined,
  ] as const)
    assert.equal(
      hasFinishedReply(
        [user, { id: "a", role: "assistant", outcome }],
        user.id,
      ),
      true,
    );
  assert.equal(
    hasFinishedReply(
      [user, { id: "a", role: "assistant", outcome: "running" }],
      user.id,
    ),
    false,
  );
  assert.equal(hasFinishedReply([user], user.id), false);
  assert.equal(
    hasFinishedReply([user, { id: "u2", role: "user" }], user.id),
    false,
  );
  assert.equal(hasFinishedReply([user], "missing"), false);
});
