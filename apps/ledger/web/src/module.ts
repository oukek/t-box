import "./features/features.css";
import "./bills/ledger.css";
import "./books/books.css";
import "./books/statistics.css";
import "./books/settings.css";
import { defineAsyncComponent } from "vue";
import {
  ledgerManifest,
  ledgerClientInteractions,
} from "@t-box/ledger-contracts";
import { APPLICATION_CONTRACT_VERSION } from "@t-box/app-contracts";
import type { ClientApplicationModule } from "@t-box/app-shell-sdk";
import { selectedBook } from "./books/bookStore";
import { booksApi } from "./books/booksApi";
import {
  requestFinancialConsent,
  resolveFinancialConsent,
} from "./financialConsent";
import {
  requestApplicationAuthorization,
  resolveApplicationAuthorization,
} from "./applicationAuthorization";
import { parseLedgerParams } from "./navigation";
let view: ReturnType<typeof loadView> | undefined;
function loadView() {
  return import("./books/BookHub.vue");
}
const ready = () => (view ||= loadView());
export const ledgerModule: ClientApplicationModule = {
  contractVersion: APPLICATION_CONTRACT_VERSION,
  manifest: ledgerManifest,
  component: defineAsyncComponent(ready),
  host: defineAsyncComponent(() => import("./Host.vue")),
  prepare: async () => {
    await ready();
  },
  navigation: "feature",
  parseParams: parseLedgerParams,
  props: (params, context) => ({
    ...params,
    openRevision: context.openRevision,
  }),
  sdk: {
    restPrefixes: ["/ledgers", "/ledger-invitations"],
    storage: true,
    events: {
      books: {
        path: "/ledgers/ws",
        subscribe(value) {
          const ledgerId = (value as { ledgerId?: unknown } | null)?.ledgerId;
          if (typeof ledgerId !== "string" || !/^[a-f0-9-]{36}$/.test(ledgerId))
            throw new Error("账本事件参数无效");
          return { type: "subscribe", ledgerId };
        },
      },
    },
  },
  installation: { kind: "user" },
  ai: {
    interactions: ledgerClientInteractions,
    clientTools: {
      finance_confirm: requestFinancialConsent,
      application_authorize: requestApplicationAuthorization,
    },
    bindings: () =>
      selectedBook.value
        ? [
            {
              appId: "ledger",
              resourceType: "book",
              resourceId: selectedBook.value.id,
            },
          ]
        : [],
    async authorize(ref, purpose) {
      if (ref.resourceType !== "book") throw new Error("不支持的账本资源");
      const { data: book } = await booksApi.get(ref.resourceId);
      return (
        await requestApplicationAuthorization({
          ledgerId: ref.resourceId,
          ledgerName: book.name,
          scope: "read",
          purpose,
        })
      ).authorized;
    },
    cancelInteractions() {
      resolveFinancialConsent(false);
      resolveApplicationAuthorization(false);
    },
  },
};
