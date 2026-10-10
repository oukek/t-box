import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRelease, type AppRelease } from "@t-box/app-contracts";
import { CapabilityRegistry } from "../src/agent/registry.js";
import { createShellModule } from "../src/agent/builtins.js";
import { definition } from "../src/application-sdk/schema.js";
import { ApiError } from "@t-box/server-foundation/errors";
import type { ApplicationModule, ToolContext } from "../src/agent/contracts.js";
import { MemorySessionRepository } from "../src/chat/session.js";
import { executeTool } from "../src/agent/executor.js";
const release: AppRelease = {
  appId: "notes",
  releaseId: "notes-1",
  protocol: 1,
  kind: "user",
  manifest: {
    id: "notes",
    name: "Notes",
    description: "Notes",
    version: "1",
    skillIds: [],
    icon: "file",
    color: "blue",
  },
  platforms: ["web"],
  runtime: {
    type: "web",
    entryUrl: "https://notes.example/",
    integrity: "sha256-" + "f".repeat(64),
  },
  backend: { type: "none", binding: "" },
  permissions: [],
  clientTools: [],
  defaultInstalled: false,
};
test("application deployment rejects executable URLs, embedded credentials, external cleartext and unsupported protocols", () => {
  validateRelease(release);
  for (const url of [
    "javascript:alert(1)",
    "file:///index.html",
    "http://notes.example/",
    "https://secret@notes.example/",
    "https://notes.example/#payload",
  ])
    assert.throws(() =>
      validateRelease({
        ...release,
        runtime: {
          type: "web",
          entryUrl: url,
          integrity: "sha256-" + "f".repeat(64),
        },
      }),
    );
  assert.throws(() => validateRelease({ ...release, protocol: 2 as any }));
});
function moduleFor(
  id: string,
  availability?: () => Promise<string>,
): ApplicationModule {
  return {
    id,
    contractVersion: "1.0",
    manifest: { ...release.manifest, id, name: id, skillIds: [`${id}_skill`] },
    availability,
    skills: {
      [`${id}_skill`]: {
        title: id,
        description: id,
        version: "1",
        tools: [`${id}_read`],
        instructions: `private-${id}-instructions`,
      },
    },
    agents: [
      {
        id,
        title: id,
        description: id,
        version: "1",
        skillIds: [`${id}_skill`],
        instructions: id,
      },
    ],
    navigation: { properties: {}, parse: () => ({}) },
    tools: {
      [`${id}_read`]: {
        definition: definition(`${id}_read`, "read", {}),
        title: "read",
        execution: "server",
        effect: "read",
        successSummary: "done",
        handler: async () => ({ private: "canary" }),
      },
    },
  };
}
test("revoked installations vanish from tools, application/agent/skill discovery and instructions", async () => {
  const notes = moduleFor("notes", async () => {
    throw new ApiError(403, "APP_NOT_INSTALLED", "not installed");
  });
  const enabled = moduleFor("enabled", async () => "release-1:1");
  const registry = new CapabilityRegistry([
    notes,
    enabled,
    createShellModule([notes, enabled]),
  ]);
  const context = {
    skills: new Set(["notes_skill", "enabled_skill"]),
    modulePins: {},
  } as unknown as ToolContext;
  const tools = await registry.availableTools(context);
  assert.ok(!tools.some((t) => t.name === "notes_read"));
  for (const [tool, field] of [
    ["app_open", "appId"],
    ["skill_activate", "skillId"],
    ["agent_delegate", "agentId"],
  ]) {
    const properties = tools.find((t) => t.name === tool)!.parameters
      .properties as any;
    assert.ok(
      !properties[field!].enum.some((value: string) =>
        value.startsWith("notes"),
      ),
    );
  }
  const instructions = await registry.instructions(context, "2026-10-06", []);
  assert.ok(!instructions.includes("private-notes-instructions"));
  assert.ok(instructions.includes("private-enabled-instructions"));
});
test("task pins permit unrelated applications but reject changed used module or installation generation", async () => {
  let generation = 1;
  const notes = moduleFor("notes", async () => `release-1:${generation}`);
  const one = new CapabilityRegistry([notes]),
    ctx = {
      skills: new Set(["notes_skill"]),
      modulePins: {},
    } as unknown as ToolContext;
  await one.requireModule("notes", ctx);
  const added = new CapabilityRegistry([notes, moduleFor("unrelated")]);
  assert.notEqual(one.revision, added.revision);
  await added.requireModule("notes", ctx);
  const changed = new CapabilityRegistry([
    { ...notes, manifest: { ...notes.manifest!, version: "2" } },
  ]);
  await assert.rejects(changed.requireModule("notes", ctx), /改变/);
  generation++;
  await assert.rejects(one.requireModule("notes", ctx), /改变/);
});
test("revocation is checked before returning an in-memory cached tool result and produces a failed timeline event", async () => {
  const module = moduleFor("notes", async () => {
    throw new ApiError(403, "APP_NOT_INSTALLED", "not installed");
  });
  const registry = new CapabilityRegistry([module]);
  const session = new MemorySessionRepository().create();
  session.calls.set("call", {
    fingerprint: "notes_read:{}",
    result: { ok: true, data: "private-result-canary" },
  });
  const message = {
    id: "message",
    role: "assistant" as const,
    content: "",
    toolCalls: [],
    createdAt: new Date().toISOString(),
  };
  session.messages.push(message);
  const ctx = {
    registry,
    skills: new Set(["notes_skill"]),
    modulePins: {},
    session,
    bindings: [],
    requestId: "request",
    signal: new AbortController().signal,
  } as unknown as ToolContext;
  const result = await executeTool(
    ctx,
    {
      view: {
        id: "run",
        requestId: "request",
        assistantMessageId: message.id,
        status: "running",
      },
      abort: new AbortController(),
    },
    message,
    { id: "call", name: "notes_read", arguments: "{}" },
    new Map(),
    { save: async () => {} },
  );
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("private-result-canary"));
  assert.equal((message.toolCalls as any[])[0].status, "failed");
});
