import { defineAsyncComponent } from "vue";
import { marketManifest } from "@t-box/market-contracts";
import { APPLICATION_CONTRACT_VERSION } from "@t-box/app-contracts";
import type { ClientApplicationModule } from "@t-box/app-shell-sdk";
export const marketModule: ClientApplicationModule = {
  contractVersion: APPLICATION_CONTRACT_VERSION,
  manifest: marketManifest,
  navigation: "shell",
  sdk: { restPrefixes: [], storage: true },
  installation: { kind: "system" },
  component: defineAsyncComponent(() => import("./MarketPage.vue")),
  parseParams(value) {
    if (!value || typeof value !== "object" || Object.keys(value).length)
      throw new Error("应用市场不接受导航参数");
    return {};
  },
  props: () => ({}),
};
