import { reactive, readonly, watch } from "vue";
import { identity } from "./session";
import {
  isDesktopIconSize,
  type DesktopIconSize,
} from "@t-box/app-contracts";

interface Preferences {
  iconSize: DesktopIconSize;
}
const defaults = (): Preferences => ({
  iconSize: "medium",
});
const state = reactive(defaults());
export const preferences = readonly(state);
const storageKey = (userId: string) => `tbox.preferences.v1:${userId}`;

// Device preferences are isolated by account; signing out resets the live values.
watch(
  () => identity.user?.id,
  (id) => {
    const values = defaults();
    try {
      const saved: unknown = id
        ? JSON.parse(localStorage.getItem(storageKey(id)) || "null")
        : null;
      if (saved && typeof saved === "object") {
        const value = (saved as Record<string, unknown>).iconSize;
        if (isDesktopIconSize(value)) values.iconSize = value;
      }
    } catch {
      /* Unavailable or invalid storage falls back to device defaults. */
    }
    Object.assign(state, values);
  },
  { immediate: true },
);

export function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
) {
  state[key] = value;
  const id = identity.user?.id;
  if (!id) return;
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(state));
  } catch {
    /* Preferences remain usable in memory when storage is blocked. */
  }
}
