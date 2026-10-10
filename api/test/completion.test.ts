import test from "node:test";
import assert from "node:assert/strict";
import type { ToolCallView, ToolResult } from "@t-box/shared";
import { receiptCompletion } from "../src/agent/completion.js";
import type { WorkflowPlan } from "../src/agent/workflow.js";
import type { ToolRegistration } from "../src/agent/contracts.js";
import { definition } from "../src/agent/schema.js";
import { createImagesModule } from "@t-box/images-server";
const plan: WorkflowPlan = {
  route: "execute",
  summary: "单次操作",
  steps: ["生成"],
  requiredTools: ["generate"],
  verification: "receipt",
};
const view = (
  id = "generate",
  name = id,
  status: ToolCallView["status"] = "completed",
): ToolCallView => ({ id, name, status, title: name, execution: "server" });
const tools: Record<string, ToolRegistration> = {
  generate: {
    definition: definition("generate", "生成", {}),
    title: "生成",
    execution: "server",
    effect: "external",
    successSummary: "已生成",
    handler: async () => ({}),
    completionSummary: (r) => (r.ok ? "已生成。" : undefined),
  },
  skill: {
    definition: definition("skill", "启用", {}),
    title: "启用",
    execution: "server",
    effect: "configuration",
    successSummary: "已启用",
    handler: async () => ({}),
  },
};
const results = new Map<string, { result: ToolResult }>([
  ["generate", { result: { ok: true, data: { id: "actual" } } }],
  ["skill", { result: { ok: true } }],
]);
test("receipt completion only accepts a model-selected, application-verified single successful operation", () => {
  assert.equal(
    receiptCompletion(plan, [view("skill"), view()], results, tools),
    "已生成。",
  );
  for (const altered of [
    undefined,
    { ...plan, verification: undefined },
    { ...plan, verification: "model" as const },
    { ...plan, steps: ["生成", "解释"] },
    { ...plan, requiredTools: ["generate", "another"] },
  ])
    assert.equal(
      receiptCompletion(altered, [view()], results, tools),
      undefined,
    );
  assert.equal(receiptCompletion(plan, [], results, tools), undefined);
  assert.equal(
    receiptCompletion(
      plan,
      [view("generate", "generate", "running")],
      results,
      tools,
    ),
    undefined,
  );
  assert.equal(receiptCompletion(plan, [view()], new Map(), tools), undefined);
  assert.equal(
    receiptCompletion(
      plan,
      [view()],
      new Map([
        [
          "generate",
          {
            result: {
              ok: false,
              error: { code: "UNCERTAIN", message: "未知" },
            },
          },
        ],
      ]),
      tools,
    ),
    undefined,
  );
  assert.equal(
    receiptCompletion(plan, [view(), view("another")], results, tools),
    undefined,
  );
  assert.equal(
    receiptCompletion(plan, [view()], results, {
      ...tools,
      generate: { ...tools.generate!, completionSummary: undefined },
    }),
    undefined,
  );
  assert.equal(
    receiptCompletion(plan, [view()], results, {
      ...tools,
      generate: {
        ...tools.generate!,
        completionSummary: () => {
          throw new Error("application verifier unavailable");
        },
      },
    }),
    undefined,
  );
});
test("image application only certifies a real image resource result, not prose or an empty receipt", () => {
  const app = createImagesModule();
  for (const name of ["images_generate", "images_edit"]) {
    const verify = app.tools[name]!.completionSummary!;
    assert.ok(
      verify({
        ok: true,
        data: {
          resources: [
            { id: "saved-resource", mimeType: "image/png", size: 100 },
          ],
        },
      }),
    );
    for (const data of [
      { text: "图片已生成" },
      { resources: [] },
      { resources: [{ id: "x", mimeType: "text/plain", size: 1 }] },
      { resources: [{ id: "x", mimeType: "image/png", size: 0 }] },
      { resources: [{ id: "x" }] },
    ])
      assert.equal(verify({ ok: true, data }), undefined);
    assert.equal(
      verify({ ok: false, error: { code: "FAILED", message: "失败" } }),
      undefined,
    );
  }
});
