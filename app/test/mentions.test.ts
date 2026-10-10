import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerManifest } from "@t-box/shared";
import {
  mentionAt,
  mentionCandidates as candidates,
} from "../src/features/chat/mentions.ts";

const mentionCandidates = (query: string) =>
  candidates(query, [ledgerManifest]);

test("app mentions respect caret ranges, Chinese input and email addresses", () => {
  assert.deepEqual(mentionAt("帮我@记账买菜", 5), {
    start: 2,
    end: 5,
    query: "记账",
  });
  assert.deepEqual(mentionAt("＠记账", 3), { start: 0, end: 3, query: "记账" });
  assert.deepEqual(mentionAt("@", 1), { start: 0, end: 1, query: "" });
  assert.equal(mentionAt("test@example.com", 16), null);
  assert.equal(mentionAt("user+tag@", 9), null);
  assert.equal(mentionAt("@记账 买菜35", 8), null);
  assert.equal(mentionAt("买菜35", 4), null);
  assert.deepEqual(
    mentionCandidates("记").map((app) => app.id),
    ["ledger"],
  );
  assert.deepEqual(
    mentionCandidates("LEDGER").map((app) => app.id),
    ["ledger"],
  );
  assert.deepEqual(mentionCandidates("unknown"), []);
});

test("mention choices come from registered modules rather than a hardcoded application catalog", () => {
  const note = {
    ...ledgerManifest,
    id: "notes",
    name: "笔记",
    skillIds: ["notes"],
  };
  assert.deepEqual(
    candidates("笔", [ledgerManifest, note]).map((app) => app.id),
    ["notes"],
  );
});
