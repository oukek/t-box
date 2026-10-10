import { FixtureChatProvider } from "./chat-provider-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { ChatServerEvent } from "@t-box/shared";
import { ApplicationChatService as ChatService } from "../src/bootstrap/chat.js";
import { MemorySessionRepository } from "../src/chat/session.js";

import { ApiError } from "@t-box/server-foundation/errors";
import type { PlatformService } from "../src/platform/service.js";
import type { BillRepository } from "@t-box/ledger-server/repository";

function fixture() {
  const userId = randomUUID();
  const platform = {
    identity: {
      authenticate: async (token: string) => {
        if (token !== "test-login")
          throw new ApiError(401, "UNAUTHENTICATED", "请登录");
        return { user: { id: userId }, sessionHash: "test-login-hash" };
      },
      authenticateHash: async () => {},
    },
  } as unknown as PlatformService;
  return { platform, userId };
}
const bills = {} as BillRepository; // Session handshakes must not touch finance.

test("authenticated blank chat gets a fresh transport after restart or idle expiry", async (t) => {
  for (const reason of ["restart", "expiry"] as const) {
    await t.test(reason, async (t) => {
      let now = 0;
      const sessions = new MemorySessionRepository(10, 100, () => now);
      const { platform, userId } = fixture();
      const service = new ChatService({
        bills,
        platform,
        sessions,
        provider: new FixtureChatProvider(),
      });
      const events: ChatServerEvent[] = [];
      const first = service.connect((event) => events.push(event));
      await first.receive({ type: "session.open", authToken: "test-login" });
      const ready = events[0];
      assert.equal(ready?.type, "session.ready");
      if (ready?.type !== "session.ready") throw new Error("Expected ready");
      first.close();
      if (reason === "restart") sessions.clear();
      else now = 11;
      const resumed = service.connect((event) => events.push(event));
      t.after(async () => {
        resumed.close();
        await service.close();
      });
      await resumed.receive({
        type: "session.open",
        authToken: "test-login",
        sessionId: ready.snapshot.sessionId,
        token: ready.token,
      });
      const fresh = events.at(-1);
      assert.equal(fresh?.type, "session.ready");
      if (fresh?.type !== "session.ready")
        throw new Error("Expected fresh ready");
      assert.equal(fresh.restored, false);
      assert.notEqual(fresh.snapshot.sessionId, ready.snapshot.sessionId);
      assert.deepEqual(fresh.snapshot.messages, []);
      assert.equal(fresh.snapshot.activeRun, null);
      assert.equal(fresh.snapshot.conversationId, undefined);
      assert.equal([...sessions.all()][0]?.userId, userId);
      assert.equal(
        events.some(
          (event) =>
            event.type === "run.started" || event.type === "tool.request",
        ),
        false,
      );
    });
  }
});

test("transport recovery still rejects invalid login and wrong credentials for a live session", async (t) => {
  const { platform } = fixture();
  const service = new ChatService({
    bills,
    platform,
    provider: new FixtureChatProvider(),
  });
  const connections: ReturnType<ChatService["connect"]>[] = [];
  t.after(async () => {
    connections.forEach((connection) => connection.close());
    await service.close();
  });
  async function open(event: unknown) {
    const events: ChatServerEvent[] = [];
    const connection = service.connect((event) => events.push(event));
    connections.push(connection);
    await connection.receive(event);
    return { event: events.at(-1), connection };
  }
  const unauthenticated = await open({
    type: "session.open",
    authToken: "wrong-login",
    sessionId: randomUUID(),
    token: "old-token",
  });
  assert.equal(unauthenticated.event?.type, "error");
  if (unauthenticated.event?.type === "error")
    assert.equal(unauthenticated.event.code, "UNAUTHENTICATED");
  assert.equal([...service.sessions.all()].length, 0);
  const first = await open({ type: "session.open", authToken: "test-login" });
  assert.equal(first.event?.type, "session.ready");
  if (first.event?.type !== "session.ready") throw new Error("Expected ready");
  first.connection.close();
  const invalid = await open({
    type: "session.open",
    authToken: "test-login",
    sessionId: first.event.snapshot.sessionId,
    token: "wrong-transport-token",
  });
  assert.equal(invalid.event?.type, "error");
  if (invalid.event?.type === "error")
    assert.equal(invalid.event.code, "SESSION_INVALID");
  assert.equal([...service.sessions.all()].length, 1);
});

test("expired transport cannot bypass archive ownership or ledger access checks", async (t) => {
  const platform = {
    ...fixture().platform,
    conversations: {
      restore: async () => {
        throw new ApiError(423, "LEDGER_LOCKED", "请解锁历史账本");
      },
    },
  } as unknown as PlatformService;
  const service = new ChatService({
    bills,
    platform,
    provider: new FixtureChatProvider(),
  });
  const events: ChatServerEvent[] = [];
  const connection = service.connect((event) => events.push(event));
  t.after(async () => {
    connection.close();
    await service.close();
  });
  await connection.receive({
    type: "session.open",
    authToken: "test-login",
    sessionId: randomUUID(),
    token: "expired-token",
    conversationId: randomUUID(),
  });
  assert.equal(events[0]?.type, "error");
  if (events[0]?.type === "error")
    assert.equal(events[0].code, "LEDGER_LOCKED");
  assert.equal([...service.sessions.all()].length, 0);
});
