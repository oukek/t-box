/** Real MySQL conversation/task/journal state; isolated fixture user and model, no real model charges. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatServerEvent, ChatSnapshot } from "@t-box/shared";
import { createDataSource } from "../src/db/data-source.js";
import { PlatformService } from "../src/platform/service.js";
import { ApplicationChatService } from "../src/bootstrap/chat.js";
import { createBillRepository } from "@t-box/ledger-server/repository";
import { definition } from "../src/agent/schema.js";
import { cleanupUsers } from "./fixtures.js";
const source = await createDataSource().initialize(),
  platform = new PlatformService(source);
let userId: string | undefined, runtime: ApplicationChatService | undefined;
const wait = async (check: () => boolean) => {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Missing message integration event");
    await new Promise((r) => setTimeout(r, 3));
  }
};
const finished = (events: ChatServerEvent[]) =>
  events.find((e) => e.type === "run.finished") as Extract<
    ChatServerEvent,
    { type: "run.finished" }
  >;
try {
  const login = await platform.identity.register(
    {
      username: `message_${randomUUID().replaceAll("-", "")}`,
      password: "test123",
      nickname: "消息调整测试",
    },
    "message-test",
  );
  userId = login.user.id;
  let firstCalls = 0,
    writes = 0;
  runtime = new ApplicationChatService({
    platform,
    bills: createBillRepository(source),
    provider: {
      mode: "openai",
      configurationKey: "message-fixture",
      async next(input) {
        const user = input.history.findLast(
          (x) => "role" in x && x.role === "user",
        );
        const text = user && "content" in user ? String(user.content) : "";
        if (text === "保存后失败") {
          if (firstCalls++ === 0) {
            const id = randomUUID();
            return {
              calls: [{ id, name: "message_fixture_save", arguments: "{}" }],
              output: [
                {
                  type: "function_call",
                  call_id: id,
                  name: "message_fixture_save",
                  arguments: "{}",
                },
              ],
            };
          }
          throw Object.assign(new Error("fixture model failure"), {
            status: 429,
          });
        }
        if (text === "再次问好")
          assert.ok(JSON.stringify(input.history).includes("actual-write"));
        if (text === "修改问题") {
          assert.ok(JSON.stringify(input.history).includes("actual-write"));
          assert.ok(!JSON.stringify(input.history).includes("第三轮"));
        }
        if (text === "删除后问答") {
          assert.ok(!JSON.stringify(input.history).includes("再次问好"));
          assert.ok(
            !JSON.stringify(input.history).includes("被删除问题的旧摘要"),
          );
        }
        input.onDelta(`回答：${text}`);
        return {
          calls: [],
          output: [{ role: "assistant", content: `回答：${text}` }],
        };
      },
    },
    modules: [
      {
        id: "message-fixture",
        skills: {},
        tools: {
          message_fixture_save: {
            definition: definition("message_fixture_save", "保存测试记录", {}),
            alwaysAvailable: true,
            title: "保存测试",
            execution: "server",
            effect: "write",
            writeFingerprint: JSON.stringify,
            successSummary: "已保存",
            handler: async () => ({ id: "actual-write", count: ++writes }),
          },
        },
      },
    ],
  });
  const events: ChatServerEvent[] = [],
    c = runtime.connect((e) => events.push(structuredClone(e)));
  await c.receive({ type: "session.open", authToken: login.token });
  await c.receive({
    type: "message.send",
    requestId: randomUUID(),
    text: "保存后失败",
    localDate: "2026-10-07",
  });
  await wait(() => !!finished(events));
  const failure = finished(events);
  assert.equal(failure.status, "failed");
  assert.equal(failure.snapshot.task?.status, "paused");
  assert.equal(writes, 1);
  const oldTask = failure.snapshot.task!.id,
    originalId = failure.snapshot.conversationId!,
    originalQuestion = failure.snapshot.messages[0]!.id;
  events.length = 0;
  await c.receive({
    type: "message.send",
    requestId: randomUUID(),
    text: "再次问好",
    localDate: "2026-10-07",
  });
  await wait(() => !!finished(events));
  let final = finished(events);
  assert.equal(
    final.status,
    "completed",
    JSON.stringify(final.snapshot.messages.at(-1)?.error),
  );
  assert.equal(writes, 1);
  const actor = await platform.identity.authenticate(login.token);
  const old = await platform.tasks.get(actor, oldTask);
  assert.equal(old.summary.status, "cancelled");
  assert.equal(old.tools[0]?.status, "completed");
  const secondQuestion = final.snapshot.messages[2]!.id;
  events.length = 0;
  await c.receive({
    type: "message.send",
    requestId: randomUUID(),
    text: "第三轮",
    localDate: "2026-10-07",
  });
  await wait(() => !!finished(events));
  final = finished(events);
  assert.equal(final.snapshot.messages.length, 6);
  const originalRevision = final.snapshot.conversationRevision;
  events.length = 0;
  const resend = {
    type: "message.resend",
    requestId: randomUUID(),
    sourceMessageId: originalQuestion,
    expectedRevision: originalRevision,
    text: "修改问题",
    localDate: "2026-10-07",
  };
  await c.receive(resend);
  await wait(() => !!finished(events));
  const branch = finished(events);
  assert.equal(
    branch.status,
    "completed",
    JSON.stringify(branch.snapshot.messages.at(-1)?.error),
  );
  assert.notEqual(branch.snapshot.conversationId, originalId);
  assert.equal(branch.snapshot.branch?.sourceConversationId, originalId);
  assert.equal(branch.snapshot.messages.length, 2);
  assert.equal(writes, 1);
  const originalArchive = await platform.conversations.load(actor, originalId);
  assert.equal(originalArchive.messages.length, 6);
  assert.equal(originalArchive.messages[4]!.content, "第三轮");
  const branchArchive = await platform.conversations.load(
    actor,
    branch.snapshot.conversationId!,
  );
  assert.equal(branchArchive.branch?.sourceMessageId, originalQuestion);
  assert.ok(branchArchive.branch?.executionContext?.includes("actual-write"));
  events.length = 0;
  await c.receive(resend);
  assert.ok(events.some((e) => e.type === "session.snapshot"));
  assert.equal(writes, 1);
  const deleteBranch = {
    type: "message.delete",
    requestId: randomUUID(),
    messageId: branch.snapshot.messages[0]!.id,
    expectedRevision: branch.snapshot.conversationRevision,
  };
  events.length = 0;
  await c.receive(deleteBranch);
  const branchDeleted = events.find(
    (e) => e.type === "message.deleted",
  ) as Extract<ChatServerEvent, { type: "message.deleted" }>;
  assert.ok(branchDeleted);
  assert.equal(branchDeleted.snapshot.messages.length, 0);
  await c.receive(deleteBranch);
  assert.equal(events.filter((e) => e.type === "message.deleted").length, 2);
  assert.equal(
    (await platform.conversations.load(actor, originalId)).messages.length,
    6,
  );
  c.close();
  const originalEvents: ChatServerEvent[] = [],
    oc = runtime.connect((e) => originalEvents.push(structuredClone(e)));
  await oc.receive({
    type: "session.open",
    authToken: login.token,
    conversationId: originalId,
  });
  const session = [...runtime.sessions.all()].find(
    (s) => s.conversationId === originalId,
  )!;
  session.history = [
    { role: "assistant", content: "被删除问题的旧摘要：再次问好" },
  ];
  session.contextState = { compactions: 1 };
  await platform.conversations.save(session);
  const command = {
    type: "message.delete",
    requestId: randomUUID(),
    messageId: secondQuestion,
    expectedRevision: originalRevision,
  };
  await oc.receive(command);
  assert.ok(
    originalEvents.some(
      (e) => e.type === "error" && e.code === "CONVERSATION_STALE",
    ),
  );
  assert.equal(session.messages.length, 6);
  originalEvents.length = 0;
  command.expectedRevision = session.archiveRevision;
  await oc.receive(command);
  const deleted = originalEvents.find(
    (e) => e.type === "message.deleted",
  ) as Extract<ChatServerEvent, { type: "message.deleted" }>;
  assert.ok(deleted);
  assert.equal(deleted.snapshot.messages.length, 4);
  const editedArchive = await platform.conversations.load(actor, originalId);
  assert.equal(editedArchive.messages.length, 4);
  assert.ok(!JSON.stringify(editedArchive.history).includes("再次问好"));
  assert.ok(!JSON.stringify(editedArchive.history).includes("旧摘要"));
  assert.deepEqual(editedArchive.contextState, {});
  assert.equal(
    (await platform.tasks.get(actor, oldTask)).tools[0]?.status,
    "completed",
  );
  originalEvents.length = 0;
  await oc.receive({
    type: "message.send",
    requestId: randomUUID(),
    text: "删除后问答",
    localDate: "2026-10-07",
  });
  await wait(() => !!finished(originalEvents));
  assert.equal(finished(originalEvents).status, "completed");
  assert.equal(writes, 1);
  oc.close();
  // A stale paused-state reader cannot retire a task that another worker has already claimed.
  const raceTask = randomUUID(),
    raceConversation = randomUUID(),
    raceOwner = randomUUID();
  await platform.tasks.create(
    actor,
    raceTask,
    raceConversation,
    randomUUID(),
    {},
    "assistant",
  );
  await platform.tasks.claim(actor, raceTask, raceOwner);
  await assert.rejects(platform.tasks.cancelSuspended(actor, raceTask), {
    code: "TASK_CHANGED",
  });
  assert.equal(
    (await platform.tasks.get(actor, raceTask)).summary.status,
    "running",
  );
  await platform.tasks.finish(raceTask, raceOwner, "paused", "fixture pause");
  await platform.tasks.cancelSuspended(actor, raceTask);
  assert.equal(
    (await platform.tasks.get(actor, raceTask)).summary.status,
    "cancelled",
  );
  assert.equal(await platform.tasks.current(actor, raceConversation), null);
  console.info(
    "Message integration passed: failed task supersession, completed write preserved, durable branch and original history, delete pair only, stale revision and retry acknowledgement, old summary removed from model input.",
  );
} finally {
  await runtime?.close();
  if (userId) await cleanupUsers(source, [userId]);
  await source.destroy();
}
