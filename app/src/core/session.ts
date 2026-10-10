import { reactive, readonly } from "vue";
import type { AppUser, UserSession } from "@t-box/shared";
const storageKey = "tbox.identity.v1";
const state = reactive({
  token: "",
  user: null as AppUser | null,
  ready: false,
  error: "",
});
try {
  state.token = localStorage.getItem(storageKey) || "";
} catch {
  /* memory fallback */
}
export const identity = readonly(state);
export function restoreError(message: string) {
  state.error = message;
  state.ready = false;
}
export function setSession(session: UserSession | null) {
  state.token = session?.token ?? "";
  state.user = session?.user ?? null;
  state.ready = true;
  state.error = "";
  try {
    if (session) localStorage.setItem(storageKey, session.token);
    else localStorage.removeItem(storageKey);
  } catch {
    /* memory fallback */
  }
}
export function restoreIdentity(user: AppUser | null) {
  state.user = user;
  state.ready = true;
  state.error = "";
  if (!user) setSession(null);
}
