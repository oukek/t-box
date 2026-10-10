import type { AppTimer, TimerAction, TimerInput } from "@t-box/time-contracts";
import { request } from "./sdk";
import { applicationMutation } from "./sdk";
export const timeApi = {
  now: (zone: string) =>
    request<{ data: ReturnType<typeof import("@t-box/shared").timeSnapshot> }>(
      `/time/now?timezone=${encodeURIComponent(zone)}`,
    ),
  list: () =>
    request<{ data: { timers: AppTimer[]; serverNow: string } }>(
      "/time/timers",
    ),
  create: (input: TimerInput) =>
    applicationMutation<{ data: AppTimer }>("/time/timers", "POST", input),
  control: (timer: AppTimer, action: TimerAction) =>
    applicationMutation<{ data: AppTimer }>(
      `/time/timers/${timer.id}/actions`,
      "POST",
      { revision: timer.revision, action },
    ),
  remove: (timer: AppTimer) =>
    applicationMutation<{ data: { deleted: boolean } }>(
      `/time/timers/${timer.id}`,
      "DELETE",
      { revision: timer.revision },
    ),
};
