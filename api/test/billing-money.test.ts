import test from "node:test";
import assert from "node:assert/strict";
import { money, decimal, tokenFee, prices } from "../src/billing/money.js";
test("fractional token fees use exact micro-yuan and round once per call", () => {
  assert.equal(decimal(money("0.100001")), "0.100001");
  assert.equal(
    tokenFee(prices({ inputPrice: "1.25", outputPrice: "2.5" }), 1, 1),
    4n,
  );
  assert.equal(tokenFee(prices({ inputPrice: "0.000001" }), 1, 0), 1n);
  assert.equal(
    tokenFee(
      prices({ inputPrice: "10", outputPrice: "20" }),
      1_000_000,
      1_000_000,
    ),
    30_000_000n,
  );
  assert.equal(decimal(-1234n), "-0.001234");
});
test("reject floats, exponent notation, negatives, precision loss and invalid usage", () => {
  for (const value of [0.1, "1e2", "-1", "NaN", "1.0000001", "1000001", null])
    assert.throws(() => money(value));
  for (const n of [-1, 1.5, NaN, Infinity, 100_000_001])
    assert.throws(() => tokenFee(prices({}), n, 0));
});
