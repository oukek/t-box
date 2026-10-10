import { defineAsyncComponent } from "vue";
import { APPLICATION_CONTRACT_VERSION } from "@t-box/app-contracts";
import {
  calendarManifest,
  calendarClientInteractions,
  parseCalendarParams,
} from "@t-box/calendar-contracts";
import type { ClientApplicationModule } from "@t-box/app-shell-sdk";
import { validateSyncArguments } from "@t-box/device-reminders/deviceReminders";
import {
  requestCalendarConfirmation,
  resolveCalendarConfirmation,
} from "./confirmation";
import { calendarApi } from "./api";
const ready = () => import("./CalendarPage.vue");
export const calendarModule: ClientApplicationModule = {
  contractVersion: APPLICATION_CONTRACT_VERSION,
  manifest: calendarManifest,
  component: defineAsyncComponent(ready),
  prepare: async () => {
    await ready();
  },
  navigation: "shell",
  host: defineAsyncComponent(() => import("./Host.vue")),
  parseParams: parseCalendarParams,
  props: (params, context) => ({
    ...params,
    openRevision: context.openRevision,
  }),
  sdk: { restPrefixes: ["/calendar"], storage: true },
  installation: { kind: "system" },
  ai: {
    interactions: calendarClientInteractions,
    clientTools: {
      calendar_reminders_sync: validateSyncArguments,
      calendar_confirm: requestCalendarConfirmation,
    },
    bindings: () => [],
    async authorize(ref) {
      if (ref.resourceType !== "event") return false;
      await calendarApi.get(ref.resourceId);
      return true;
    },
    cancelInteractions() {
      resolveCalendarConfirmation(false);
    },
  },
};
