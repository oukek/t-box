import test from "node:test";
import assert from "node:assert/strict";
import {
  elapsedExecution,
  formatExecutionTime,
} from "../src/features/chat/executionTime.js";
test("elapsed time ticks only while active and formats seconds and minutes at boundaries", () => {
  const start = Date.parse("2026-10-07T00:00:00.000Z");
  const execution = {
    startedAt: new Date(start).toISOString(),
    durationMs: 2000,
    activeSince: new Date(start + 5000).toISOString(),
  };
  assert.equal(elapsedExecution(execution, true, start + 8000), 5000);
  assert.equal(elapsedExecution(execution, false, start + 8000), 2000);
  assert.equal(elapsedExecution(execution, true, start + 1000), 2000);
  assert.equal(
    elapsedExecution(
      { ...execution, activeSince: undefined },
      false,
      start + 999999,
    ),
    2000,
  );
  assert.equal(formatExecutionTime(0), "0 秒");
  assert.equal(formatExecutionTime(59999), "59 秒");
  assert.equal(formatExecutionTime(60000), "1 分钟 0 秒");
  assert.equal(formatExecutionTime(125000), "2 分钟 5 秒");
});
