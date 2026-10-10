import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingPurchaseBlockReason,
  IOS_PURCHASE_UNAVAILABLE,
  selectPaymentMode,
} from "../src/features/billing/paymentEnvironment.ts";

test("AI credit purchases are blocked in the iOS shell, independently of payment channel", () => {
  assert.equal(
    billingPurchaseBlockReason(true, "ios"),
    IOS_PURCHASE_UNAVAILABLE,
  );
  assert.equal(billingPurchaseBlockReason(true, "android"), null);
  assert.equal(billingPurchaseBlockReason(false, "web"), null);
  assert.equal(billingPurchaseBlockReason(false, "ios"), null);
  assert.equal(selectPaymentMode(false, "iPhone", true), "h5");
});
test("Capacitor WebViews always select APP payment, browser modes remain distinct", () => {
  for (const ua of ["Android MicroMessenger", "iPhone", "Macintosh"])
    assert.equal(selectPaymentMode(true, ua, false), "app");
  assert.equal(
    selectPaymentMode(false, "iPhone MicroMessenger", true),
    "jsapi",
  );
  assert.equal(selectPaymentMode(false, "Android", false), "h5");
  assert.equal(selectPaymentMode(false, "Macintosh", false), "native");
  assert.equal(selectPaymentMode(false, "Macintosh", true), "h5");
});
