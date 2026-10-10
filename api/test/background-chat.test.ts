import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { ChatServerEvent, ToolResult } from "@t-box/shared";
import { ChatService } from "../src/chat/engine.js";
import { MemorySessionRepository } from "../src/chat/session.js";
import { CapabilityRegistry } from "../src/agent/registry.js";
import { createShellModule } from "../src/agent/builtins.js";
import { definition } from "../src/agent/schema.js";
import { requestClient } from "../src/agent/interaction.js";
import type { ApplicationModule } from "../src/agent/contracts.js";
import type { ChatProvider, ProviderTurn } from "../src/chat/provider.js";

const turn = (id: string, name: string): ProviderTurn => ({
  calls: [{ id, name, arguments: "{}" }],
  output: [{ type: "function_call", call_id: id, name, arguments: "{}" }],
});
const done: ProviderTurn = {
  calls: [],
  output: [{ role: "assistant", content: "完成" }],
};
const wait = async (check: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Missing background execution state");
    await new Promise((r) => setTimeout(r, 2));
  }
};
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(
  t: TestContext,
  handler: ApplicationModule["tools"][string]["handler"],
  after: ProviderTurn[] = [],
  confirm = false,
) {
  const module: ApplicationModule = {
    id: "notes",
    manifest: {
      id: "notes",
      name: "笔记",
      description: "fixture",
      icon: "file",
      color: "blue",
      version: "1",
      skillIds: ["notes"],
    },
    skills: {
      notes: {
        title: "笔记",
        description: "fixture",
        version: "1",
        tools: ["notes_save"],
        instructions: "按用户请求保存",
      },
    },
    tools: {
      notes_save: {
        definition: definition("notes_save", "保存", {}),
        title: "保存",
        execution: "server",
        effect: "write",
        successSummary: "已保存",
        writeFingerprint: JSON.stringify,
        handler,
        ...(confirm
          ? { confirm: async () => ({ name: "notes_confirm", arguments: {} }) }
          : {}),
      },
    },
    interactions: [
      {
        name: "notes_confirm",
        title: "确认",
        description: "fixture",
        purpose: "confirmation",
        inputSchema: {},
      },
      {
        name: "notes_sync",
        title: "同步",
        description: "fixture",
        purpose: "ui",
        inputSchema: {},
      },
    ],
    navigation: { properties: {}, parse: () => ({}) },
  };
  const steps = [turn("write", "notes_save"), ...after];
  const provider: ChatProvider = {
    mode: "openai",
    next: async () => steps.shift() || done,
  };
  const chat = new ChatService({
    registry: new CapabilityRegistry([module, createShellModule([module])]),
    provider,
  });
  const events: ChatServerEvent[] = [];
  const connection = chat.connect((e) => events.push(structuredClone(e)));
  t.after(async () => {
    connection.close();
    await chat.close();
  });
  const open = async () => {
    await connection.receive({ type: "session.open" });
    const ready = events[0] as Extract<
      ChatServerEvent,
      { type: "session.ready" }
    >;
    await connection.receive({
      type: "message.send",
      requestId: "background",
      text: "保存笔记",
      localDate: "2026-10-06",
      applicationIds: ["notes"],
    });
    return ready;
  };
  return { chat, events, connection, open };
}

test("disconnect during a server write keeps executing and the finished result is available on reconnect", async (t) => {
  const barrier = gate();
  let started = false,
    writes = 0;
  const f = setup(t, async () => {
    started = true;
    await barrier.promise;
    return { count: ++writes };
  });
  const ready = await f.open();
  await wait(() => started);
  f.connection.close();
  assert.equal(
    [...f.chat.sessions.all()][0]!.active!.abort.signal.aborted,
    false,
  );
  const oldEvents = f.events.length;
  barrier.resolve();
  await wait(
    () =>
      ![...f.chat.sessions.all()][0]!.active &&
      ![...f.chat.sessions.all()][0]!.finishing,
  );
  assert.equal(writes, 1);
  assert.equal(
    f.events.length,
    oldEvents,
    "closed sockets receive no further events",
  );
  const events: ChatServerEvent[] = [];
  const restored = f.chat.connect((e) => events.push(e));
  t.after(() => restored.close());
  await restored.receive({
    type: "session.open",
    sessionId: ready.snapshot.sessionId,
    token: ready.token,
  });
  const snapshot = (events[0] as typeof ready).snapshot;
  assert.equal(snapshot.activeRun, null);
  assert.equal(snapshot.messages.at(-1)!.outcome, "completed");
  assert.equal(snapshot.messages.at(-1)!.content, "完成");
  assert.equal(snapshot.messages.at(-1)!.toolCalls[0]!.status, "completed");
  assert.deepEqual(
    snapshot.messages.at(-1)!.timeline!.map((x) => x.sequence),
    [1, 2],
  );
});

test("offline client navigation pauses before dispatch without caching a fabricated tool failure", async (t) => {
  const barrier = gate();
  let started = false;
  const open: ProviderTurn = {
    calls: [
      {
        id: "open",
        name: "app_open",
        arguments: '{"appId":"notes","params":null}',
      },
    ],
    output: [
      {
        type: "function_call",
        call_id: "open",
        name: "app_open",
        arguments: '{"appId":"notes","params":null}',
      },
    ],
  };
  const f = setup(t, async () => {
    started = true;
    await barrier.promise;
    return {};
  }, [open]);
  await f.open();
  await wait(() => started);
  f.connection.close();
  barrier.resolve();
  const session = [...f.chat.sessions.all()][0]!;
  await wait(() => !session.active && !session.finishing);
  assert.equal(session.messages.at(-1)!.outcome, "paused");
  assert.equal(
    session.messages.at(-1)!.toolCalls.at(-1)!.status,
    "waiting_client",
  );
  assert.equal(session.calls.has("write"), true);
  assert.equal(session.calls.has("open"), false);
  assert.equal(
    f.events.some((e) => e.type === "tool.request"),
    false,
  );
});

test("disconnect during a confirmation preserves its wait and cannot execute the write", async (t) => {
  let writes = 0;
  const f = setup(t, async () => ({ count: ++writes }), [], true);
  await f.open();
  await wait(() => f.events.some((e) => e.type === "tool.request"));
  f.connection.close();
  const session = [...f.chat.sessions.all()][0]!;
  await wait(() => !session.active && !session.finishing);
  assert.equal(writes, 0);
  assert.equal(session.calls.has("write"), false);
  assert.equal(session.messages.at(-1)!.toolCalls[0]!.status, "waiting_client");
});

test("reconnecting while work is active attaches a new subscriber and does not duplicate execution", async (t) => {
  const barrier = gate();
  let started = false,
    writes = 0;
  const f = setup(t, async () => {
    started = true;
    await barrier.promise;
    return { count: ++writes };
  });
  const ready = await f.open();
  await wait(() => started);
  f.connection.close();
  const events: ChatServerEvent[] = [];
  const restored = f.chat.connect((e) => events.push(e));
  t.after(() => restored.close());
  await restored.receive({
    type: "session.open",
    sessionId: ready.snapshot.sessionId,
    token: ready.token,
  });
  assert.equal(
    (events[0] as typeof ready).snapshot.activeRun?.id,
    [...f.chat.sessions.all()][0]!.active!.view.id,
  );
  barrier.resolve();
  await wait(() => events.some((e) => e.type === "run.finished"));
  assert.equal(writes, 1);
  assert.equal(events.filter((e) => e.type === "run.started").length, 0);
});

test("post-write optional device synchronization does not block offline backend completion", async (t) => {
  const barrier = gate();
  let started = false,
    sync: ToolResult | undefined;
  const f = setup(t, async (_args, ctx) => {
    started = true;
    await barrier.promise;
    sync = await ctx.interact({
      name: "notes_sync",
      arguments: {},
      optional: true,
    });
    return { saved: true };
  });
  await f.open();
  await wait(() => started);
  f.connection.close();
  barrier.resolve();
  const session = [...f.chat.sessions.all()][0]!;
  await wait(() => !session.active && !session.finishing);
  assert.equal(sync?.ok, false);
  if (sync?.ok === false) assert.equal(sync.error.code, "CLIENT_SYNC_DEFERRED");
  assert.equal(session.messages.at(-1)!.outcome, "completed");
});

test("optional sync interrupted after send returns deferred status; mandatory waits abort into a resumable boundary", async () => {
  const session = new MemorySessionRepository().create();
  session.owner = Symbol("device");
  session.send = () => {};
  const run = {
    view: {
      id: "run",
      requestId: "request",
      assistantMessageId: "message",
      status: "running" as const,
    },
    abort: new AbortController(),
  };
  session.active = run;
  const optional = requestClient(session, run, "sync", {
    name: "sync",
    arguments: {},
    optional: true,
  });
  session.owner = undefined;
  session.send = undefined;
  session.active.pending!.disconnect();
  assert.equal((await optional).ok, false);
  assert.equal(run.abort.signal.aborted, false);
  assert.equal(session.active.pending, undefined);
  assert.throws(() =>
    requestClient(session, run, "password", {
      name: "authorize",
      arguments: {},
    }),
  );
  assert.equal(run.abort.signal.reason, "CLIENT_REQUIRED");
});
