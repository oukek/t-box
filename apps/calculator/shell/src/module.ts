import type { RuntimeDescriptor } from "@t-box/app-contracts";
import { identity } from "@t-box/app-shell-sdk";
import { defineAsyncComponent } from "vue";
import {
  APPLICATION_CONTRACT_VERSION,
  calculatorManifest,
  parseCalculatorParams,
} from "@t-box/shared";
import type { ClientApplicationModule } from "@t-box/app-shell-sdk";
export function createCalculatorShellModule(
  loadRuntime: () => Promise<{ default: import("vue").Component }>,
): ClientApplicationModule {
  const ready = loadRuntime;
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: calculatorManifest,
    component: defineAsyncComponent(ready),
    prepare: async () => {
      await ready();
    },
    navigation: "shell",
    parseParams: parseCalculatorParams,
    props: (params, context) => ({
      initializeRuntime: migrateHistory,
      appId: "calculator",
      params,
      openRevision: context.openRevision,
    }),
    installation: { kind: "system" },
    ai: {
      clientTools: {},
      interactions: [],
      bindings: () => [],
      authorize: async () => false,
      cancelInteractions() {},
    },
  };
}

/** One-time migration from the former shell origin; keep the original record for rollback. */
async function migrateHistory(runtime: RuntimeDescriptor) {
  if (!identity.user || !runtime.permissions.includes("storage")) return;
  try {
    const target = `tbox.app.calculator.${runtime.subject}.calculator.history.v1`;
    if (localStorage.getItem(target) !== null) return;
    const old = localStorage.getItem(
      `tbox.calculator.history.v1:${identity.user.id}`,
    );
    if (!old || old.length > 64000) return;
    const value = JSON.parse(old);
    if (Array.isArray(value))
      localStorage.setItem(target, JSON.stringify(value.slice(0, 20)));
  } catch {
    /* Storage is optional; no financial/business data is removed. */
  }
}
