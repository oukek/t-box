import type {
  HolidayYearSnapshot,
  CalendarEvent,
  CalendarEventInput,
  CalendarOccurrence,
  CalendarException,
} from "@t-box/calendar-contracts";
import { request } from "./sdk";
import { applicationMutation } from "./sdk";
export const calendarApi = {
  holidayYear: (year: number, signal?: AbortSignal) =>
    request<{ data: HolidayYearSnapshot }>(`/calendar/holiday-years/${year}`, {
      signal,
    }),
  events: (search = "") =>
    request<{ data: CalendarEvent[] }>(
      `/calendar/events?search=${encodeURIComponent(search)}`,
    ),
  get: (id: string) =>
    request<{ data: CalendarEvent }>(
      `/calendar/events/${encodeURIComponent(id)}`,
    ),
  states: (id: string) =>
    request<{ data: CalendarException[] }>(
      `/calendar/events/${id}/occurrence-states`,
    ),
  occurrences: (
    from: string,
    to: string,
    timezone: string,
    search = "",
    kind = "",
  ) =>
    request<{
      data: { occurrences: CalendarOccurrence[]; truncated: boolean };
    }>(
      `/calendar/occurrences?${new URLSearchParams({ from, to, timezone, ...(search ? { search } : {}), ...(kind ? { kind } : {}) })}`,
    ),
  create: (event: CalendarEventInput) =>
    applicationMutation<{ data: CalendarEvent }>(
      "/calendar/events",
      "POST",
      event,
    ),
  update: (event: CalendarEvent, input: CalendarEventInput) =>
    applicationMutation<{ data: CalendarEvent }>(
      `/calendar/events/${event.id}`,
      "PATCH",
      { revision: event.revision, event: input },
    ),
  remove: (event: CalendarEvent) =>
    applicationMutation(`/calendar/events/${event.id}`, "DELETE", {
      revision: event.revision,
    }),
  state: (
    event: CalendarEvent,
    date: string,
    state: "normal" | "completed" | "skipped",
  ) =>
    applicationMutation(
      `/calendar/events/${event.id}/occurrence-state`,
      "POST",
      { revision: event.revision, date, state },
    ),
};
