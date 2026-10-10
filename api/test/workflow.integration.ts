/** Real MySQL/task/billing storage; fixture model only, no external model requests. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import type { ChatServerEvent } from "@t-box/shared";
import { createDataSource } from "../src/db/data-source.js";
import { ConfigurationService } from "../src/admin/service.js";
import { AdminStore } from "../src/admin/store.js";
import { createVault, hashPassword } from "../src/admin/crypto.js";
import { createBillRepository } from "@t-box/ledger-server/repository";
import { ApplicationChatService } from "../src/bootstrap/chat.js";
import { createApp } from "../src/app.js";
import { PlatformService } from "../src/platform/service.js";
import { MeteredChatProvider } from "../src/billing/provider.js";
import type { ProviderTurn, ChatProvider } from "../src/chat/provider.js";
import { definition } from "../src/agent/schema.js";
import { cleanupUsers } from "./fixtures.js";
const source = await createDataSource().initialize();
const configuration = new ConfigurationService(
  new AdminStore(source),
  createVault(randomBytes(32)),
);
const original = await configuration.workflow.snapshot();
const platform = new PlatformService(source);
const bills = createBillRepository(source);
const app = createApp({
  administration: configuration,
  bills,
  health: async () => ({ mysql: "up", redis: "disabled" }),
});
const adminId = randomUUID(),
  providerId = randomUUID(),
  modelId = randomUUID();
let userId: string | undefined,
  workflowChanged = false,
  runtime: ApplicationChatService | undefined;
const call = (name: string, args: unknown): ProviderTurn => {
  const id = randomUUID();
  return {
    calls: [{ id, name, arguments: JSON.stringify(args) }],
    output: [
      {
        type: "function_call",
        call_id: id,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  };
};
const wait = async (check: () => boolean) => {
  const until = Date.now() + 7000;
  while (!check()) {
    if (Date.now() > until)
      throw new Error("Missing workflow integration event");
    await new Promise((r) => setTimeout(r, 5));
  }
};
try {
  await source.query(
    "INSERT INTO admin_users(id,username,password_hash,enabled) VALUES(?,?,?,1)",
    [adminId, `workflow_${adminId.slice(0, 8)}`, await hashPassword("test123")],
  );
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/session",
    headers: { "x-admin-request": "1" },
    payload: {
      username: `workflow_${adminId.slice(0, 8)}`,
      password: "test123",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/admin/workflow" }))
      .statusCode,
    401,
  );
  const before = await app.inject({
    method: "GET",
    url: "/api/v1/admin/workflow",
    headers: { cookie },
  });
  assert.equal(before.json().data.revision, original.revision);
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/workflow",
        headers: { cookie, "x-admin-request": "1" },
        payload: {
          revision: original.revision,
          prompts: { analysis: "short" },
        },
      })
    ).statusCode,
    400,
  );
  const loginUser = await platform.identity.register(
    {
      username: `workflow_${randomUUID().replaceAll("-", "")}`,
      password: "test123",
      nickname: "流程测试",
    },
    "workflow-test",
  );
  userId = loginUser.user.id;
  await source.query(
    "INSERT INTO ai_providers(id,name,base_url,key_cipher,enabled) VALUES(?,?,?,?,1)",
    [providerId, "workflow-fixture", "http://localhost:1/v1", "fixture"],
  );
  await source.query(
    "INSERT INTO ai_models(id,provider_id,model_id,name,enabled) VALUES(?,?,?,?,1)",
    [modelId, providerId, "fixture", "workflow-fixture"],
  );
  let writes = 0,
    analysis = 0,
    answerAttempts = 0;
  let runtimeConfiguration = {
    revision: 101,
    values: { "ai.retry.maxRetries": 0, "ai.prompt.assistant": "配置快照测试" },
  };
  const provider: ChatProvider = {
    mode: "openai",
    configurationKey: "workflow-fixture",
    async next(input) {
      assert.equal(input.configuration?.revision, 101);
      if (input.execution?.purpose === "answer" && answerAttempts++ === 0)
        throw Object.assign(new Error("sensitive fixture upstream text"), {
          status: 429,
          code: "rate_limit_exceeded",
        });
      await input.onUsage?.({
        responseId: randomUUID(),
        inputTokens: 12,
        outputTokens: 3,
        cachedInputTokens: 5,
      });
      if (input.tools[0]?.name === "workflow_plan") {
        analysis++;
        return call("workflow_plan", {
          route: "execute",
          summary: "先执行测试操作，再核对回执。",
          steps: ["保存一次"],
          requiredTools: ["workflow_fixture_save"],
        });
      }
      if (input.execution?.purpose === "review")
        return call("workflow_review", {
          action: "complete",
          summary: "保存回执已确认。",
          next: "",
        });
      if (input.execution?.purpose === "answer") {
        input.onDelta("已保存一次。");
        return {
          calls: [],
          output: [{ role: "assistant", content: "已保存一次。" }],
        };
      }
      if (
        !input.history.some(
          (x) =>
            x.type === "function_call" && x.name === "workflow_fixture_save",
        )
      )
        return call("workflow_fixture_save", {});
      input.onDelta("实际回执已收到。");
      return {
        calls: [],
        output: [{ role: "assistant", content: "实际回执已收到。" }],
      };
    },
  };
  runtime = new ApplicationChatService({
    platform,
    bills,
    workflow: configuration.workflow,
    configuration: { snapshot: async () => structuredClone(runtimeConfiguration) },
    provider: new MeteredChatProvider(provider, platform.billing, modelId, {
      inputPrice: "0",
      outputPrice: "0",
      imagePrice: "0",
    }),
    modules: [
      {
        id: "workflow-fixture",
        skills: {},
        tools: {
          workflow_fixture_save: {
            definition: definition("workflow_fixture_save", "保存测试数据", {}),
            alwaysAvailable: true,
            title: "保存测试",
            execution: "server",
            effect: "write",
            writeFingerprint: JSON.stringify,
            successSummary: "已保存",
            handler: async () => ({ count: ++writes }),
          },
        },
      },
    ],
  });
  const events: ChatServerEvent[] = [];
  const c = runtime.connect((e) => events.push(structuredClone(e)));
  await c.receive({ type: "session.open", authToken: loginUser.token });
  assert.equal(events[0]?.type, "session.ready");
  assert.deepEqual(events[1], { type: "runtime.configuration", maxMessageLength: 2000 });
  await c.receive({
    type: "message.send",
    requestId: randomUUID(),
    text: "保存测试数据一次",
    localDate: "2026-10-07",
  });
  await wait(() => events.some((e) => e.type === "run.finished"));
  let final = events.find((e) => e.type === "run.finished") as Extract<
    ChatServerEvent,
    { type: "run.finished" }
  >;
  assert.equal(final.status, "failed");
  assert.equal(final.snapshot.task?.status, "paused");
  assert.match(
    final.snapshot.messages.at(-1)!.content,
    /429.*rate_limit_exceeded/,
  );
  const taskId = final.snapshot.task!.id,
    actor = await platform.identity.authenticate(loginUser.token);
  const paused = await platform.tasks.get(actor, taskId);
  assert.equal((paused.checkpoint as any).workflow.revision, original.revision);
  assert.equal((paused.checkpoint as any).configuration.revision, 101);
  assert.equal((paused.checkpoint as any).frames[0].workflow.phase, "answer");
  const update = await app.inject({
    method: "PATCH",
    url: "/api/v1/admin/workflow",
    headers: { cookie, "x-admin-request": "1" },
    payload: { revision: original.revision, prompts: original.prompts },
  });
  assert.equal(update.statusCode, 200);
  workflowChanged = true;
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/workflow",
        headers: { cookie, "x-admin-request": "1" },
        payload: { revision: original.revision, prompts: original.prompts },
      })
    ).statusCode,
    409,
  );
  events.length = 0;
  runtimeConfiguration = {
    revision: 102,
    values: { "ai.retry.maxRetries": 5, "ai.prompt.assistant": "已修改的配置" },
  };
  await c.receive({ type: "task.resume", taskId });
  await wait(() => events.some((e) => e.type === "run.finished"));
  final = events.find((e) => e.type === "run.finished") as typeof final;
  assert.equal(final.status, "completed");
  assert.equal(writes, 1);
  assert.equal(analysis, 1);
  assert.equal(final.snapshot.messages.at(-1)!.error, undefined);
  const completed = await platform.tasks.get(actor, taskId);
  assert.equal((completed.checkpoint as any).configuration.revision, 101);
  assert.equal(
    (completed.checkpoint as any).workflow.revision,
    original.revision,
  );
  const usage = await platform.billing.records(userId);
  assert.ok(usage.some((r) => r.purpose === "response"));
  assert.ok(usage.some((r) => r.purpose === "review"));
  assert.ok(usage.some((r) => r.purpose === "answer"));
  const archived = await platform.conversations.load(
    actor,
    final.snapshot.conversationId!,
  );
  assert.ok(JSON.stringify(archived).includes("结果核对"));
  c.close();
  console.info(
    "Workflow integration passed: admin validation/version conflict, durable phase snapshot, failure cause, resume without repeated writes, phase billing and timeline archive.",
  );
} finally {
  await runtime?.close();
  await app.close();
  if (workflowChanged) {
    const current = await configuration.workflow.snapshot();
    await configuration.workflow.save(
      { revision: current.revision, prompts: original.prompts },
      adminId,
    );
  }
  if (userId) await cleanupUsers(source, [userId]);
  await source.query("DELETE FROM ai_models WHERE id=?", [modelId]);
  await source.query("DELETE FROM ai_providers WHERE id=?", [providerId]);
  await source.query("DELETE FROM admin_sessions WHERE admin_id=?", [adminId]);
  await source.query("DELETE FROM admin_users WHERE id=?", [adminId]);
  await source.destroy();
}
