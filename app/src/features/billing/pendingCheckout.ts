import { Capacitor } from "@capacitor/core";
import type { PaymentOrder } from "@t-box/shared";
import { identity } from "../../core/session";
import { request } from "../../core/network";
import { navigation, openRecharge } from "../../core/navigation";
function store() {
  return Capacitor.isNativePlatform() ? localStorage : sessionStorage;
}
function key() {
  return `tbox.payment.order:${identity.user?.id ?? ""}`;
}
export function pendingCheckout(): string | null {
  try {
    const id = store().getItem(key());
    return id &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
      ? id
      : null;
  } catch {
    return null;
  }
}
export function rememberCheckout(id: string) {
  try {
    store().setItem(key(), id);
  } catch {
    /* Orders remain recoverable from server history. */
  }
}
export function forgetCheckout() {
  try {
    store().removeItem(key());
  } catch {
    /* Optional client hint only. */
  }
}
/** Cold-start SDK callbacks can precede the bridge. Restore the owned server order after login. */
export async function recoverNativeCheckout() {
  if (!Capacitor.isNativePlatform() || !identity.user) return;
  const id = pendingCheckout(),
    userId = identity.user.id;
  if (!id || navigation.screen === "recharge") return;
  try {
    const { data } = await request<{ data: PaymentOrder }>(
      `/payments/orders/${id}`,
    );
    if (identity.user?.id !== userId) return;
    if (data.status === "pending" && Date.parse(data.expiresAt) > Date.now())
      openRecharge(id);
    else forgetCheckout();
  } catch {
    /* Offline startup must not block the rest of the application. */
  }
}
