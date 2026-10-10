import test from "node:test";
import assert from "node:assert/strict";
import { cents, money } from "@t-box/ledger-server/finance/money";
import {
  toCents,
  fromCents,
  difference,
  formatMoney,
} from "@t-box/ledger-web/bills/format";
test("signed money and frontend aggregation remain exact beyond Number precision", () => {
  for (const value of [
    "-0.01",
    "0.00",
    "999999999.99",
    "9007199254740993.10",
  ]) {
    assert.equal(money(cents(value)), value);
    assert.equal(fromCents(toCents(value)), value);
  }
  assert.equal(fromCents(toCents("0.10") + toCents("0.20")), "0.30");
  assert.equal(
    difference("9007199254740993.10", "9007199254740993.01"),
    "0.09",
  );
  assert.equal(formatMoney("9007199254740993.10"), "9,007,199,254,740,993.10");
});
