/** Real task/archive/resource storage. --live also uses the configured conversation
 * model; image pixels are always a tiny local fixture, never a paid image call. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatServerEvent } from "@t-box/shared";
import { createImagesModule, type ImageOperation } from "@t-box/images-server";
import { createDataSource } from "../src/db/data-source.js";
import { PlatformService } from "../src/platform/service.js";
import { AdminStore } from "../src/admin/store.js";
import { ConfigurationService } from "../src/admin/service.js";
import { createVault, loadEncryptionKey } from "../src/admin/crypto.js";
import { ChatService } from "../src/chat/engine.js";
import { CapabilityRegistry } from "../src/agent/registry.js";
import { createShellModule } from "../src/agent/builtins.js";
import { adaptApplication } from "../src/bootstrap/application-adapter.js";
import { attachmentPort } from "../src/resources/chat.js";
import { createConversationProvider } from "../src/chat/provider-factory.js";
import { MeteredChatProvider } from "../src/billing/provider.js";
import type { ChatProvider, ProviderTurn } from "../src/chat/provider.js";
import type { RunCheckpoint } from "../src/agent/checkpoint.js";
import { publicRunError, runErrorDiagnostics } from "../src/chat/errors.js";
import { cleanupUsers } from "./fixtures.js";
const live = process.argv.includes("--live");
const source = await createDataSource().initialize();
let runtime: ChatService | undefined, userId: string | undefined;
try {
  const configuration = new ConfigurationService(
    new AdminStore(source),
    createVault(loadEncryptionKey()),
  );
  const platform = new PlatformService(source);
  const login = await platform.identity.register(
    {
      username: `image_flow_${randomUUID().replaceAll("-", "")}`,
      password: "test123",
      nickname: "图片流程验证",
    },
    "image-flow-test",
  );
  userId = login.user.id;
  let imageCalls = 0,
    modelCalls = 0;
  const module = adaptApplication(
    createImagesModule({
      forRun(actor) {
        const operation = Object.assign(
          async () => {
            imageCalls++;
            const resource = await platform.resources.create(
              actor,
              "fixture.png",
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvJkAAAAASUVORK5CYII=",
                "base64",
              ),
              "generated",
            );
            return { resources: [resource] };
          },
          { prepare: async () => ({}) },
        );
        return operation as ImageOperation;
      },
    }),
  );
  const registry = new CapabilityRegistry([
    module,
    createShellModule([module]),
  ]);
  platform.conversations.setAccess(registry.access);
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
  let raw: ChatProvider;
  if (live) {
    const config = await configuration.runtime();
    assert.ok(config, "请先配置普通会话模型");
    raw = new MeteredChatProvider(
      createConversationProvider(config),
      platform.billing,
      config.billingModelId,
      { inputPrice: "0", outputPrice: "0", imagePrice: "0" },
    );
  } else
    raw = {
      mode: "openai",
      configurationKey: "image-fixture",
      async next(input) {
        if (input.tools[0]?.name === "workflow_plan")
          return call("workflow_plan", {
            route: "execute",
            summary: "生成一张图片。",
            steps: ["生成图片"],
            requiredTools: ["images_generate"],
            verification: "receipt",
          });
        if (
          !input.history.some(
            (i) => i.type === "function_call" && i.name === "skill_activate",
          )
        )
          return call("skill_activate", { skillId: "image_processing" });
        return call("images_generate", { prompt: "1:1海景、海浪和海鸥" });
      },
    };
  const provider: ChatProvider = {
    mode: raw.mode,
    configurationKey: raw.configurationKey,
    contextPolicy: raw.contextPolicy,
    maxOutputTokens: raw.maxOutputTokens,
    async next(input) {
      modelCalls++;
      return raw.next(input);
    },
  };
  const checkpoint = platform.tasks.checkpoint.bind(platform.tasks);
  let interrupted = false;
  if (!live)
    platform.tasks.checkpoint = async (...args) => {
      const state = args[2] as RunCheckpoint;
      if (!interrupted && state.frames[0]?.done) {
        interrupted = true;
        throw new Error("Simulated final checkpoint failure");
      }
      await checkpoint(...args);
    };
  runtime = new ChatService({
    registry,
    provider,
    workflow: configuration.workflow,
    host: {
      identity: platform.identity,
      tasks: platform.tasks,
      conversations: platform.conversations,
      attachments: attachmentPort(platform.resources),
    },
  });
  const events: ChatServerEvent[] = [];
  const connection = runtime.connect((e) => events.push(structuredClone(e)));
  const wait = async () => {
    const end = Date.now() + (live ? 180000 : 8000);
    while (!events.some((e) => e.type === "run.finished")) {
      if (Date.now() > end) throw new Error("Image workflow timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const final = () =>
    events.find((e) => e.type === "run.finished") as Extract<
      ChatServerEvent,
      { type: "run.finished" }
    >;
  await connection.receive({ type: "session.open", authToken: login.token });
  await connection.receive({
    type: "message.send",
    requestId: randomUUID(),
    text: "生成一张1:1方形海景图片，包含海浪和海鸥，只需要图片。",
    localDate: "2026-10-08",
  });
  await wait();
  if (!live) {
    assert.equal(final().status, "failed");
    const id = final().snapshot.task!.id;
    const saved = await platform.tasks.get(
      await platform.identity.authenticate(login.token),
      id,
    );
    assert.equal(
      (saved.checkpoint as RunCheckpoint).frames[0]!.workflow!.phase,
      "execution",
    );
    assert.equal(final().snapshot.messages.at(-1)!.attachments?.length, 1);
    await runtime.close();
    connection.close();
    // New runtime: resume solely from MySQL, not from the original in-memory writes.
    runtime = new ChatService({
      registry,
      provider,
      workflow: configuration.workflow,
      host: {
        identity: platform.identity,
        tasks: platform.tasks,
        conversations: platform.conversations,
        attachments: attachmentPort(platform.resources),
      },
    });
    events.length = 0;
    const resumed = runtime.connect((e) => events.push(structuredClone(e)));
    await resumed.receive({
      type: "session.open",
      authToken: login.token,
      conversationId: saved.summary.conversationId,
    });
    await resumed.receive({ type: "task.resume", taskId: id });
    await wait();
    resumed.close();
  }
  const end = final(),
    message = end.snapshot.messages.at(-1)!;
  console.log(
    JSON.stringify({
      live,
      status: end.status,
      modelCalls,
      imageCalls,
      timelineKinds: message.timeline?.map((i) => i.kind),
      attachments: message.attachments?.length,
      error: message.error,
    }),
  );
  assert.equal(end.status, "completed");
  assert.equal(imageCalls, 1);
  assert.ok(
    modelCalls <= 3,
    "单次生图应由应用成功回执直接交付，不再进行候选、核对和总结请求",
  );
  assert.equal(message.content, "图片已生成并保存。");
  assert.equal(message.attachments?.length, 1);
  assert.equal(message.timeline!.at(-1)!.kind, "answer");
  assert.equal(message.error, undefined);
  const [rows] = await source.query(
    "SELECT COUNT(*) AS total FROM resources WHERE user_id=?",
    [userId],
  );
  assert.equal(Number(rows.total), 1);
  connection.close();
  if (!live) {
    await runtime.close();
    let failReview = true;
    const complexProvider: ChatProvider = {
      mode: "openai",
      configurationKey: "complex-image-fixture",
      async next(input) {
        if (input.tools[0]?.name === "workflow_plan")
          return call("workflow_plan", {
            route: "execute",
            summary: "生成图片并说明。",
            steps: ["生成图片", "解释构图"],
            requiredTools: ["images_generate"],
            verification: "model",
          });
        if (input.tools[0]?.name === "workflow_review") {
          if (failReview) {
            failReview = false;
            throw Object.assign(new Error("private upstream failure body"), {
              status: 400,
            });
          }
          return call("workflow_review", {
            action: "complete",
            summary: "图片回执已核对。",
            next: "",
          });
        }
        if (input.toolChoice === "none")
          return {
            calls: [],
            output: [
              { role: "assistant", content: "图片已生成；构图说明已完成。" },
            ],
          };
        if (
          !input.history.some(
            (i) => i.type === "function_call" && i.name === "skill_activate",
          )
        )
          return call("skill_activate", { skillId: "image_processing" });
        if (
          !input.history.some(
            (i) => i.type === "function_call" && i.name === "images_generate",
          )
        )
          return call("images_generate", { prompt: "方形海景" });
        return {
          calls: [],
          output: [
            { role: "assistant", content: "图片工具返回了已保存的资源。" },
          ],
        };
      },
    };
    runtime = new ChatService({
      registry,
      provider: complexProvider,
      workflow: configuration.workflow,
      host: {
        identity: platform.identity,
        tasks: platform.tasks,
        conversations: platform.conversations,
        attachments: attachmentPort(platform.resources),
      },
    });
    events.length = 0;
    const complex = runtime.connect((event) =>
      events.push(structuredClone(event)),
    );
    await complex.receive({ type: "session.open", authToken: login.token });
    await complex.receive({
      type: "message.send",
      requestId: randomUUID(),
      text: "生成海景并解释构图",
      localDate: "2026-10-08",
    });
    await wait();
    assert.equal(final().status, "failed");
    assert.match(
      final().snapshot.messages.at(-1)!.content,
      /图片已生成并保存.*结果核对失败.*400/,
    );
    assert.equal(final().snapshot.messages.at(-1)!.attachments?.length, 1);
    assert.equal(imageCalls, 2);
    assert.ok(
      !JSON.stringify(final()).includes("private upstream failure body"),
    );
    const taskId = final().snapshot.task!.id;
    events.length = 0;
    await complex.receive({ type: "task.resume", taskId });
    await wait();
    assert.equal(final().status, "completed");
    assert.equal(imageCalls, 2, "核对失败后的恢复不能重复生图");
    assert.equal(final().snapshot.messages.at(-1)!.attachments?.length, 1);
    complex.close();
    console.log(
      "PASS: complex image review HTTP 400 keeps the resource; resume completes without generating again.",
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: publicRunError(error),
      diagnostics: runErrorDiagnostics(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await runtime?.close();
  await cleanupUsers(source, userId ? [userId] : []);
  await source.destroy();
}
