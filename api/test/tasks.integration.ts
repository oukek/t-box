import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatServerEvent } from "@t-box/shared";
import { createDataSource } from "../src/db/data-source.js";
import { PlatformService } from "../src/platform/service.js";
import { TaskStore } from "../src/tasks/store.js";
import { ApplicationChatService } from "../src/bootstrap/chat.js";
import { createBillRepository } from "@t-box/ledger-server/repository";
import type { ChatProvider, ProviderTurn } from "../src/chat/provider.js";
import type { RunCheckpoint } from "../src/agent/checkpoint.js";
import { createApp } from "../src/app.js";
import { cleanupUsers } from "./fixtures.js";
const source = await createDataSource().initialize(),
  p = new PlatformService(source),
  users: string[] = [],
  services: ApplicationChatService[] = [];
const wait = async (check: () => boolean) => {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Missing task event");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const call = (id: string, name: string, args: unknown): ProviderTurn => ({
  calls: [{ id, name, arguments: JSON.stringify(args) }],
  output: [
    {
      type: "function_call",
      call_id: id,
      name,
      arguments: JSON.stringify(args),
    },
  ],
});
try {
  const login = await p.identity.register(
    {
      username: `tasks_${randomUUID().replaceAll("-", "")}`,
      password: "test123",
    },
    "tasks-fixture",
  );
  users.push(login.user.id);
  const actor = await p.identity.authenticate(login.token),
    book = (await p.ledgers.list(actor))[0]!;
  const [{ id: category }] = await source.query(
    "SELECT id FROM bill_categories WHERE ledger_id=? AND type='expense' LIMIT 1",
    [book.id],
  );
  const input = {
    type: "expense",
    amount: "10",
    category,
    date: "2026-10-06",
    note: "durable fixture",
  };
  const provider: ChatProvider = {
    mode: "openai",
    configurationKey: "fixture-stable",
    async next(model) {
      const outputs = model.history.filter(
        (x) => x.type === "function_call_output",
      );
      if (model.instructions.includes("你是 T Box 的记账助手")) {
        if (!outputs.length)
          return call("persist-write", "bills_create", input);
        if (outputs.length === 1)
          return call("second-normalized-write", "bills_create", {
            ...input,
            amount: "10.00",
          });
        model.onDelta("已记录10元");
        return {
          calls: [],
          output: [{ role: "assistant", content: "已记录10元" }],
        };
      }
      if (!outputs.length)
        return call("delegate-ledger", "agent_delegate", {
          agentId: "ledger",
          task: "按用户请求记录支出10元",
        });
      assert.match(JSON.stringify(model.history), /已记录10元/);
      model.onDelta("已完成，账单保存一次。");
      return {
        calls: [],
        output: [{ role: "assistant", content: "已完成，账单保存一次。" }],
      };
    },
  };
  const original = p.tasks.checkpoint.bind(p.tasks);
  let injectFailure = true;
  p.tasks.checkpoint = async (...args) => {
    const state = args[2] as RunCheckpoint;
    if (injectFailure && state.writes.length) {
      injectFailure = false;
      throw new Error(
        "Simulated crash after tool journal commit, before checkpoint commit",
      );
    }
    return original(...args);
  };
  const start = async (restoreId?: string) => {
    const service = new ApplicationChatService({
      platform: p,
      bills: createBillRepository(source),
      provider,
    });
    services.push(service);
    const events: ChatServerEvent[] = [];
    const connection = service.connect((event) => events.push(event));
    await connection.receive({
      type: "session.open",
      authToken: login.token,
      ...(restoreId ? { conversationId: restoreId } : {}),
    });
    assert.equal(events.at(-1)?.type, "session.ready");
    return { service, events, connection };
  };
  const first = await start();
  await first.connection.receive({
    type: "message.send",
    requestId: "durable-request",
    text: "记一笔支出10元",
    localDate: "2026-10-06",
    scopeBindings: [
      { appId: "ledger", resourceType: "book", resourceId: book.id },
    ],
  });
  await wait(() => first.events.some((e) => e.type === "run.finished"));
  const session = [...first.service.sessions.all()][0]!,
    taskId = session.task!.id,
    conversationId = session.conversationId!;
  assert.equal(session.task!.status, "paused");
  const task = await p.tasks.get(actor, taskId),
    checkpoint = task.checkpoint as RunCheckpoint;
  assert.deepEqual(
    checkpoint.frames.map((f) => f.agentId),
    ["assistant", "ledger"],
  );
  assert.ok(checkpoint.execution?.finishedAt);
  assert.equal(checkpoint.execution?.activeSince, undefined);
  assert.equal(checkpoint.frames.at(-1)!.calls[0]!.id, "persist-write");
  assert.equal(task.tools[0]!.status, "completed");
  assert.equal(
    (
      await source.query("SELECT id FROM bills WHERE ledger_id=? AND note=?", [
        book.id,
        input.note,
      ])
    ).length,
    1,
  );
  first.connection.close();
  await first.service.close();
  const restarted = await start(conversationId);
  await restarted.connection.receive({ type: "task.resume", taskId });
  await wait(() => restarted.events.some((e) => e.type === "run.finished"));
  const finished = restarted.events.find(
    (e) => e.type === "run.finished",
  ) as Extract<ChatServerEvent, { type: "run.finished" }>;
  assert.equal(finished.status, "completed");
  assert.equal(
    finished.snapshot.messages.at(-1)!.execution?.startedAt,
    checkpoint.execution!.startedAt,
  );
  assert.ok(
    finished.snapshot.messages.at(-1)!.execution!.durationMs >=
      checkpoint.execution!.durationMs,
  );
  assert.equal(finished.snapshot.task!.status, "completed");
  assert.equal(
    (
      await source.query("SELECT id FROM bills WHERE ledger_id=? AND note=?", [
        book.id,
        input.note,
      ])
    ).length,
    1,
    "completed write journal must deduplicate even a new model call ID after checkpoint loss",
  );
  assert.equal((await p.tasks.get(actor, taskId)).tools.length, 1);
  console.log(
    "PASS: specialist stack survives restart; committed tool result and normalized repeat are reused, bill written once.",
  );

  // Browser absence is not execution cancellation. Exercise the real MySQL task lease/journal.
  for (const needsPage of [false, true]) {
    const note = needsPage ? "offline-page-boundary" : "offline-server-finish";
    let release!: () => void,
      modelWaiting = false;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const offlineProvider: ChatProvider = {
      mode: "openai",
      configurationKey: "offline-fixture",
      async next(model) {
        const outputs = model.history.filter(
          (x) => x.type === "function_call_output",
        );
        if (!outputs.length) {
          modelWaiting = true;
          await barrier;
          return call("offline-write", "bills_create", { ...input, note });
        }
        if (needsPage && outputs.length === 1)
          return call("offline-open", "app_open", {
            appId: "ledger",
            params: null,
          });
        return {
          calls: [],
          output: [{ role: "assistant", content: "已保存，任务完成" }],
        };
      },
    };
    const offlineChat = new ApplicationChatService({
      platform: p,
      bills: createBillRepository(source),
      provider: offlineProvider,
    });
    services.push(offlineChat);
    const offlineEvents: ChatServerEvent[] = [];
    const offlineConnection = offlineChat.connect((e) => offlineEvents.push(e));
    await offlineConnection.receive({
      type: "session.open",
      authToken: login.token,
    });
    await offlineConnection.receive({
      type: "message.send",
      requestId: note,
      text: "记录10元",
      localDate: "2026-10-06",
      applicationIds: ["ledger"],
      scopeBindings: [
        { appId: "ledger", resourceType: "book", resourceId: book.id },
      ],
    });
    await wait(() => modelWaiting);
    const offlineSession = [...offlineChat.sessions.all()][0]!;
    const eventCount = offlineEvents.length;
    offlineConnection.close();
    release();
    await wait(() => !offlineSession.active && !offlineSession.finishing);
    const saved = await p.tasks.get(actor, offlineSession.task!.id);
    assert.equal(
      saved.summary.status,
      needsPage ? "waiting_client" : "completed",
    );
    assert.equal(offlineEvents.length, eventCount);
    assert.equal(
      saved.tools.length,
      1,
      "absent UI must not be journaled as a dispatched effect",
    );
    assert.equal(saved.tools[0]!.status, "completed");
    assert.equal(
      (
        await source.query(
          "SELECT id FROM bills WHERE ledger_id=? AND note=?",
          [book.id, note],
        )
      ).length,
      1,
    );
    const restoredEvents: ChatServerEvent[] = [];
    const restoredConnection = offlineChat.connect((e) =>
      restoredEvents.push(e),
    );
    await restoredConnection.receive({
      type: "session.open",
      authToken: login.token,
      conversationId: offlineSession.conversationId,
    });
    assert.equal(restoredEvents[0]?.type, "session.ready");
    if (needsPage) {
      const cp = saved.checkpoint as RunCheckpoint;
      assert.equal(cp.frames.at(-1)!.calls[0]!.name, "app_open");
      assert.equal(
        cp.session.messages.at(-1)!.toolCalls.at(-1)!.status,
        "waiting_client",
      );
      await restoredConnection.receive({
        type: "task.resume",
        taskId: saved.summary.id,
      });
      await wait(() => restoredEvents.some((e) => e.type === "tool.request"));
      const prompt = restoredEvents.find(
        (e) => e.type === "tool.request",
      ) as Extract<ChatServerEvent, { type: "tool.request" }>;
      await restoredConnection.receive({
        type: "tool.result",
        runId: prompt.runId,
        callId: prompt.callId,
        result: { ok: true },
      });
      await wait(() => restoredEvents.some((e) => e.type === "run.finished"));
      assert.equal(
        (await p.tasks.get(actor, saved.summary.id)).summary.status,
        "completed",
      );
      assert.equal(
        (
          await source.query(
            "SELECT id FROM bills WHERE ledger_id=? AND note=?",
            [book.id, note],
          )
        ).length,
        1,
      );
    } else {
      const ready = restoredEvents[0] as Extract<
        ChatServerEvent,
        { type: "session.ready" }
      >;
      assert.equal(ready.snapshot.messages.at(-1)!.content, "已保存，任务完成");
      assert.equal(ready.snapshot.activeRun, null);
    }
    restoredConnection.close();
    await offlineChat.close();
  }
  console.log(
    "PASS: backend model/tool loop completes after disconnect; only a UI boundary pauses and its resume never repeats the committed bill.",
  );

  const queueId = randomUUID(),
    queueConversation = randomUUID(),
    workerA = randomUUID(),
    workerB = randomUUID();
  const queueState = { ...checkpoint, runId: queueId };
  await p.tasks.create(
    actor,
    queueId,
    queueConversation,
    "queued-request",
    queueState,
    "assistant",
  );
  const competitor = new TaskStore(source);
  const claims = await Promise.allSettled([
    p.tasks.claim(actor, queueId, workerA),
    competitor.claim(actor, queueId, workerB),
  ]);
  assert.equal(claims.filter((c) => c.status === "fulfilled").length, 1);
  const winner = claims[0]!.status === "fulfilled" ? workerA : workerB,
    loser = winner === workerA ? workerB : workerA;
  await assert.rejects(() => p.tasks.guard(queueId, loser), /租约失效/);
  await p.tasks.journal(queueId, winner).dispatch(
    {
      id: "unconfirmed",
      name: "external_submit",
      arguments: "{}",
      writeKey: "one-effect",
    },
    "external",
    "images",
  );
  await source.query(
    "UPDATE agent_tasks SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
    [queueId],
  );
  await competitor.recover();
  assert.equal(
    (await p.tasks.get(actor, queueId)).summary.status,
    "needs_review",
  );
  await assert.rejects(
    () => competitor.claim(actor, queueId, randomUUID()),
    /不能重复运行/,
  );
  await assert.rejects(
    () =>
      p.tasks
        .journal(queueId, winner)
        .complete("unconfirmed", { ok: true, data: {} }),
    /未能持久保存/,
  );
  await p.tasks.cancel(actor, queueId);
  assert.equal((await p.tasks.get(actor, queueId)).summary.status, "cancelled");
  console.log(
    "PASS: database lease allows one worker; stale owners are fenced and unknown external effects are never retried.",
  );

  const failedImageId = randomUUID(),
    failedImageOwner = randomUUID();
  await p.tasks.create(
    actor,
    failedImageId,
    randomUUID(),
    "failed-image",
    checkpoint,
    "assistant",
  );
  await p.tasks.claim(actor, failedImageId, failedImageOwner);
  const failedJournal = p.tasks.journal(failedImageId, failedImageOwner);
  await failedJournal.dispatch(
    { id: "image", name: "images_generate", arguments: "{}" },
    "external",
    "images",
  );
  await assert.rejects(
    failedJournal.complete("image", {
      ok: false,
      error: {
        code: "IMAGE_DOWNLOAD_FAILED",
        message: "服务商图片下载失败（HTTP 403）",
      },
    }),
    (error) => error instanceof Error && error.message.includes("HTTP 403"),
  );
  assert.equal(
    (await p.tasks.get(actor, failedImageId)).tools[0]!.status,
    "uncertain",
  );
  await assert.rejects(
    failedJournal.lookup({
      id: "image",
      name: "images_generate",
      arguments: "{}",
    }),
    /禁止自动重复/,
  );
  await p.tasks.cancel(actor, failedImageId);

  const pausedId = randomUUID(),
    pausedConversation = randomUUID(),
    pausedOwner = randomUUID();
  await p.tasks.create(
    actor,
    pausedId,
    pausedConversation,
    "read-only-recovery",
    { ...checkpoint, runId: pausedId },
    "assistant",
  );
  await p.tasks.claim(actor, pausedId, pausedOwner);
  await p.tasks
    .journal(pausedId, pausedOwner)
    .dispatch(
      { id: "read", name: "read_data", arguments: "{}" },
      "read",
      "assistant",
    );
  await source.query(
    "UPDATE agent_tasks SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",
    [pausedId],
  );
  await competitor.recover();
  assert.equal((await p.tasks.get(actor, pausedId)).summary.status, "paused");
  const nextOwner = randomUUID();
  await competitor.claim(actor, pausedId, nextOwner);
  assert.equal(
    await competitor
      .journal(pausedId, nextOwner)
      .lookup({ id: "read", name: "read_data", arguments: "{}" }),
    undefined,
  );
  await p.tasks.cancel(actor, pausedId);
  await p.tasks.finish(pausedId, nextOwner, "paused");
  assert.equal(
    (await p.tasks.get(actor, pausedId)).summary.status,
    "cancelled",
  );
  console.log(
    "PASS: interrupted reads can resume; persisted cancellation releases admission after the worker stops.",
  );

  // An older API instance must not overwrite a more recent archive or admit stale work.
  const makeSession = (): import("../src/chat/session.js").ChatSession => ({
    id: randomUUID(),
    userId: actor.user.id,
    token: "fixture",
    expiresAt: Date.now() + 60000,
    messages: [],
    history: [],
    requests: new Map(),
    calls: new Map(),
  });
  const fresh = makeSession();
  await p.conversations.restore(actor, conversationId, fresh);
  const stale = makeSession();
  await p.conversations.restore(actor, conversationId, stale);
  await p.conversations.save(fresh);
  await assert.rejects(() => p.conversations.save(stale), /会话已更新/);
  await assert.rejects(
    () =>
      p.tasks.create(
        actor,
        randomUUID(),
        conversationId,
        "stale-admission",
        checkpoint,
        "assistant",
        true,
        stale.archiveRevision,
      ),
    /其他连接更新/,
  );
  console.log(
    "PASS: archive revisions reject stale writes and stale queue admission across API instances.",
  );

  const confirmBook = await p.ledgers.create(actor, {
    name: "恢复确认账本",
    template: "combined",
    password: "lock123",
  });
  const debtInput = {
    direction: "payable",
    counterparty: "测试对象",
    amount: "25",
    date: "2026-10-06",
    dueDate: null,
    note: "恢复确认",
    cashMovement: true,
  };
  const confirmProvider: ChatProvider = {
    mode: "openai",
    async next(model) {
      if (!model.history.some((x) => x.type === "function_call_output"))
        return call("debt-confirm", "debts_create", debtInput);
      return { calls: [], output: [{ role: "assistant", content: "已完成" }] };
    },
  };
  const confirmChat = new ApplicationChatService({
    platform: p,
    bills: createBillRepository(source),
    provider: confirmProvider,
  });
  services.push(confirmChat);
  const confirmEvents: ChatServerEvent[] = [],
    confirmConnection = confirmChat.connect((e) => confirmEvents.push(e));
  await confirmConnection.receive({
    type: "session.open",
    authToken: login.token,
  });
  await confirmConnection.receive({
    type: "message.send",
    requestId: "confirm-resume",
    text: "借入测试对象25元",
    localDate: "2026-10-06",
    applicationIds: ["ledger"],
    scopeBindings: [
      { appId: "ledger", resourceType: "book", resourceId: confirmBook.id },
    ],
  });
  await wait(() => confirmEvents.some((e) => e.type === "tool.request"));
  const oldPrompt = confirmEvents.find(
    (e) => e.type === "tool.request",
  ) as Extract<ChatServerEvent, { type: "tool.request" }>;
  const confirmSession = [...confirmChat.sessions.all()][0]!;
  confirmConnection.close();
  await confirmChat.close();
  assert.equal(
    (await p.tasks.get(actor, oldPrompt.runId)).summary.status,
    "waiting_client",
  );
  assert.equal(
    (await p.finance.debts(actor, confirmBook.id, {})).data.length,
    0,
  );
  await p.ledgers.lock(actor, confirmBook.id);
  const resumeChat = new ApplicationChatService({
    platform: p,
    bills: createBillRepository(source),
    provider: confirmProvider,
  });
  services.push(resumeChat);
  const resumeEvents: ChatServerEvent[] = [],
    resumeConnection = resumeChat.connect((e) => resumeEvents.push(e));
  await resumeConnection.receive({
    type: "session.open",
    authToken: login.token,
    conversationId: confirmSession.conversationId,
  });
  const lockedEvent = resumeEvents.at(-1);
  assert.equal(lockedEvent?.type, "error");
  if (lockedEvent?.type !== "error")
    throw new Error("Expected locked resource recovery challenge");
  assert.equal(lockedEvent.code, "RESOURCE_LOCKED");
  assert.deepEqual(lockedEvent.resourceRefs, [
    { appId: "ledger", resourceType: "book", resourceId: confirmBook.id },
  ]);
  assert.equal(JSON.stringify(lockedEvent).includes("lock123"), false);
  assert.equal(JSON.stringify(lockedEvent).includes("恢复确认"), false);
  // The frontend sends passwords directly to the application API, then retries the transport handshake.
  await p.ledgers.unlock(actor, confirmBook.id, {
    password: "lock123",
    scope: "write",
  });
  await resumeConnection.receive({
    type: "session.open",
    authToken: login.token,
    conversationId: confirmSession.conversationId,
  });
  assert.equal(resumeEvents.at(-1)?.type, "session.ready");
  await resumeConnection.receive({
    type: "task.resume",
    taskId: oldPrompt.runId,
  });
  await wait(() => resumeEvents.some((e) => e.type === "tool.request"));
  const newPrompt = resumeEvents.find(
    (e) => e.type === "tool.request",
  ) as Extract<ChatServerEvent, { type: "tool.request" }>;
  assert.notEqual(
    newPrompt.callId,
    oldPrompt.callId,
    "each resumed UI prompt must have a fresh nonce",
  );
  await resumeConnection.receive({
    type: "tool.result",
    runId: oldPrompt.runId,
    callId: oldPrompt.callId,
    result: { ok: true, data: { approved: true } },
  });
  assert.equal(
    (resumeEvents.at(-1) as { code: string }).code,
    "INVALID_TOOL_RESULT",
  );
  assert.equal(
    (await p.finance.debts(actor, confirmBook.id, {})).data.length,
    0,
  );
  await resumeConnection.receive({
    type: "tool.result",
    runId: newPrompt.runId,
    callId: newPrompt.callId,
    result: { ok: true, data: { approved: true } },
  });
  await wait(() => resumeEvents.some((e) => e.type === "run.finished"));
  assert.equal(
    (await p.finance.debts(actor, confirmBook.id, {})).data.length,
    1,
  );
  console.log(
    "PASS: expired grants expose only authorization resource metadata; fresh unlock and confirmation are required, and old approval cannot authorize the resumed operation.",
  );

  // Task admission must remain recoverable if its very first conversation archive write fails.
  const archiveSave = p.conversations.save.bind(p.conversations);
  let unavailableArchive = true;
  p.conversations.save = async (...args) => {
    if (
      unavailableArchive &&
      args[0].messages.some((m) => m.content === "归档恢复测试")
    )
      throw new Error("Simulated first archive outage");
    return archiveSave(...args);
  };
  const archiveProvider: ChatProvider = {
    mode: "openai",
    configurationKey: "archive-fixture",
    async next(model) {
      model.onDelta("已恢复");
      return { calls: [], output: [{ role: "assistant", content: "已恢复" }] };
    },
  };
  const interruptedArchive = new ApplicationChatService({
    platform: p,
    bills: createBillRepository(source),
    provider: archiveProvider,
  });
  services.push(interruptedArchive);
  const archiveEvents: ChatServerEvent[] = [],
    archiveConnection = interruptedArchive.connect((e) =>
      archiveEvents.push(e),
    );
  await archiveConnection.receive({
    type: "session.open",
    authToken: login.token,
  });
  await archiveConnection.receive({
    type: "message.send",
    requestId: "first-archive-outage",
    text: "归档恢复测试",
    localDate: "2026-10-06",
  });
  await wait(() => archiveEvents.some((e) => e.type === "run.finished"));
  const interruptedSession = [...interruptedArchive.sessions.all()][0]!;
  assert.equal(
    await p.conversations.exists(actor, interruptedSession.conversationId!),
    false,
  );
  archiveConnection.close();
  await interruptedArchive.close();
  unavailableArchive = false;
  const restoredArchive = new ApplicationChatService({
    platform: p,
    bills: createBillRepository(source),
    provider: archiveProvider,
  });
  services.push(restoredArchive);
  const restoredEvents: ChatServerEvent[] = [],
    restoredConnection = restoredArchive.connect((e) => restoredEvents.push(e));
  await restoredConnection.receive({
    type: "session.open",
    authToken: login.token,
    conversationId: interruptedSession.conversationId,
  });
  assert.equal(restoredEvents.at(-1)?.type, "session.ready");
  await restoredConnection.receive({
    type: "task.resume",
    taskId: interruptedSession.task!.id,
  });
  await wait(() => restoredEvents.some((e) => e.type === "run.finished"));
  assert.equal(
    (await p.tasks.get(actor, interruptedSession.task!.id)).summary.status,
    "completed",
  );
  p.conversations.save = archiveSave;
  console.log(
    "PASS: a task survives failure of its first archive write and recreates its owned conversation before resuming.",
  );

  const outsider = await p.identity.register(
    {
      username: `outsider_${randomUUID().replaceAll("-", "")}`,
      password: "test123",
      nickname: "任务测试",
    },
    "task-outsider",
  );
  users.push(outsider.user.id);
  await assert.rejects(
    () => p.tasks.get(awaitActor(outsider.user.id), taskId),
    /不存在/,
  );
  const app = createApp({
    platform: p,
    bills: createBillRepository(source),
    chatProvider: provider,
    health: async () => ({ mysql: "up", redis: "disabled" }),
  });
  try {
    const own = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${login.token}` },
    });
    assert.equal(own.statusCode, 200);
    assert.ok(own.json().data.tools[0].title);
    assert.ok(!own.body.includes("checkpoint"));
    assert.ok(!own.body.includes(actor.sessionHash));
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    assert.equal(denied.statusCode, 404);
    await p.ledgers.password(actor, book.id, {
      password: "lock123",
      accountPassword: "test123",
    });
    const locked = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${login.token}` },
    });
    assert.equal(locked.statusCode, 423);
    console.log(
      "PASS: REST task details enforce ownership and locked resource grants; checkpoints and credentials are never exposed.",
    );
  } finally {
    await app.close();
  }
  function awaitActor(userId: string) {
    return { ...actor, user: { ...actor.user, id: userId } };
  }
} finally {
  for (const service of services) await service.close();
  await cleanupUsers(source, users);
  await source.destroy();
}
