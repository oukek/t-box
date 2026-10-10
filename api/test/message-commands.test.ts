import test from "node:test";
import assert from "node:assert/strict";
import type { ChatServerEvent, ChatMessage } from "@t-box/shared";
import { ChatService } from "../src/chat/engine.js";
import { MemorySessionRepository } from "../src/chat/session.js";
import { CapabilityRegistry } from "../src/agent/registry.js";
import { createShellModule } from "../src/agent/builtins.js";
import {
  messagePair,
  deleteMessagePair,
  forkMessageConversation,
  checkMessageRevision,
} from "../src/chat/message-commands.js";
import type { AgentRuntimeOptions } from "../src/agent/contracts.js";
const messages = (): ChatMessage[] =>
  Array.from({ length: 3 }, (_, i) => [
    {
      id: `u${i}`,
      role: "user" as const,
      content: `问题 ${i}`,
      createdAt: "now",
      toolCalls: [],
    },
    {
      id: `a${i}`,
      role: "assistant" as const,
      content: `回答 ${i}`,
      createdAt: "now",
      toolCalls: [],
      outcome: "completed" as const,
    },
  ]).flat();
function fixture() {
  const sessions = new MemorySessionRepository(),
    current = sessions.create(),
    registry = new CapabilityRegistry([createShellModule([])]);
  current.messages = messages();
  current.history = [{ role: "assistant", content: "旧摘要含已删除的事实" }];
  current.contextState = { compactions: 2 };
  const options: AgentRuntimeOptions = {
    sessions,
    registry,
    provider: {
      mode: "openai",
      async next() {
        return { calls: [], output: [] };
      },
    },
  };
  return { sessions, current, options };
}
const until = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Missing message test event");
    await new Promise((r) => setTimeout(r, 2));
  }
};
test("deleting either side removes exactly one paired turn and rebuilds context without old summary", async () => {
  const { current, options } = fixture();
  const ids = await deleteMessagePair(options, current, undefined, {
    requestId: "delete-1",
    messageId: "a1",
  });
  assert.deepEqual(ids, ["u1", "a1"]);
  assert.deepEqual(
    current.messages.map((m) => m.id),
    ["u0", "a0", "u2", "a2"],
  );
  assert.ok(!JSON.stringify(current.history).includes("问题 1"));
  assert.ok(!JSON.stringify(current.history).includes("旧摘要"));
  assert.deepEqual(current.contextState, {});
  assert.deepEqual(
    await deleteMessagePair(options, current, undefined, {
      requestId: "delete-1",
      messageId: "a1",
    }),
    ids,
  );
  await assert.rejects(
    deleteMessagePair(options, current, undefined, {
      requestId: "delete-1",
      messageId: "a0",
    }),
    { code: "REQUEST_ID_CONFLICT" },
  );
});
test("delete persistence failure rolls back the pair and memory; revision checks reject stale commands", async () => {
  const { current, options } = fixture(),
    before = structuredClone(current.messages);
  current.archiveRevision = 3;
  assert.throws(() => checkMessageRevision(current, 2), {
    code: "CONVERSATION_STALE",
  });
  assert.throws(() => checkMessageRevision(current, NaN), {
    code: "INVALID_EVENT",
  });
  options.host = {
    identity: {
      async authenticate() {
        throw new Error("unused");
      },
      async authenticateHash() {},
    },
    conversations: {
      async save() {
        throw new Error("save failed");
      },
      async load() {},
      async restore() {},
      async exists() {
        return true;
      },
    },
  };
  await assert.rejects(
    deleteMessagePair(options, current, undefined, {
      requestId: "delete",
      messageId: "u1",
    }),
    /save failed/,
  );
  assert.deepEqual(current.messages, before);
  assert.deepEqual(current.contextState, { compactions: 2 });
  assert.equal(current.messageCommands, undefined);
});
test("fork keeps the source unchanged and isolates only earlier turns while retaining factual side-effect context", () => {
  const { current, options, sessions } = fixture();
  current.conversationId = "source";
  current.title = "测试对话";
  current.messages[3]!.toolCalls = [
    {
      id: "saved-write",
      name: "app_write",
      title: "保存",
      execution: "server",
      status: "completed",
    },
  ];
  current.calls.set("saved-write", {
    fingerprint: "app_write:{}",
    result: { ok: true, data: { id: "actual-write" } },
  });
  const before = structuredClone(current.messages),
    branch = forkMessageConversation(options, current, sessions, "u1");
  assert.deepEqual(current.messages, before);
  assert.deepEqual(
    branch.messages.map((m) => m.id),
    ["u0", "a0"],
  );
  assert.notEqual(branch.conversationId, current.conversationId);
  assert.equal(branch.branch?.sourceMessageId, "u1");
  assert.ok(JSON.stringify(branch.history).includes("actual-write"));
  assert.ok(!JSON.stringify(branch.history).includes("问题 2"));
  branch.messages[0]!.content = "branch change";
  assert.equal(current.messages[0]!.content, "问题 0");
  assert.throws(() => messagePair(current.messages, "missing"), {
    code: "MESSAGE_NOT_FOUND",
  });
});
test("message deletion is socket acknowledged; duplicate commands do not repeat a mutation", async (t) => {
  const { sessions, current, options } = fixture();
  current.history = [];
  const events: ChatServerEvent[] = [],
    service = new ChatService(options),
    c = service.connect((e) => events.push(structuredClone(e)));
  t.after(async () => {
    c.close();
    await service.close();
  });
  await c.receive({
    type: "session.open",
    sessionId: current.id,
    token: current.token,
  });
  const command = {
    type: "message.delete",
    requestId: "pair-delete",
    messageId: "u1",
  };
  await c.receive(command);
  await c.receive(command);
  assert.equal(events.filter((e) => e.type === "message.deleted").length, 2);
  assert.deepEqual(
    current.messages.map((m) => m.id),
    ["u0", "a0", "u2", "a2"],
  );
});
test("resending switches to a new branch, uses revised text and leaves original later answers available", async (t) => {
  const { sessions, current, options } = fixture();
  current.history = [];
  let calls = 0;
  options.provider = {
    mode: "openai",
    async next(input) {
      calls++;
      assert.ok(JSON.stringify(input.history).includes("修改后的问题"));
      assert.ok(!JSON.stringify(input.history).includes("问题 2"));
      input.onDelta("新回答");
      return { calls: [], output: [{ role: "assistant", content: "新回答" }] };
    },
  };
  const events: ChatServerEvent[] = [],
    service = new ChatService(options),
    c = service.connect((e) => events.push(structuredClone(e)));
  t.after(async () => {
    c.close();
    await service.close();
  });
  await c.receive({
    type: "session.open",
    sessionId: current.id,
    token: current.token,
  });
  const event = {
    type: "message.resend",
    requestId: "resend",
    sourceMessageId: "u1",
    text: "修改后的问题",
    localDate: "2026-10-07",
  };
  await c.receive(event);
  await until(() => events.some((e) => e.type === "run.finished"));
  const final = events.find((e) => e.type === "run.finished") as Extract<
    ChatServerEvent,
    { type: "run.finished" }
  >;
  assert.equal(final.status, "completed");
  assert.equal(final.snapshot.branch?.sourceMessageId, "u1");
  assert.equal(current.messages.length, 6);
  assert.deepEqual(
    final.snapshot.messages.map((m) => m.content),
    ["问题 0", "回答 0", "修改后的问题", "新回答"],
  );
  await c.receive(event);
  assert.equal(calls, 1, "same request is acknowledged without rerunning");
});
