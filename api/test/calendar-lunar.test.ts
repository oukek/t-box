import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dayjs } from "@t-box/shared";
import {
  parseCalendarEvent,
  lunarToSolar,
  solarToLunar,
  lunarMonths,
  lunarDays,
  occursOn,
  expandCalendar,
  occurrenceReminders,
  type CalendarEvent,
  type CalendarLunarDate,
  type CalendarEventInput,
} from "@t-box/calendar-contracts";
const lunar = (value: Partial<CalendarLunarDate> = {}): CalendarLunarDate => ({
  year: 2025,
  month: 1,
  day: 1,
  leapMonth: false,
  leapPolicy: "regular",
  ...value,
});
function event(
  date = lunar(),
  extra: Partial<CalendarEventInput> = {},
): CalendarEvent {
  const start = lunarToSolar(date);
  return {
    ...parseCalendarEvent({
      title: "农历生日",
      description: "",
      location: "",
      kind: "birthday",
      color: "teal",
      allDay: true,
      start,
      end: dayjs.utc(start).add(1, "day").format("YYYY-MM-DD"),
      timezone: "Asia/Shanghai",
      lunar: date,
      recurrence: {
        frequency: "yearly",
        interval: 1,
        weekdays: [],
        until: null,
        monthPolicy: "skip",
      },
      reminders: [0, 1440],
      ...extra,
    }),
    id: randomUUID(),
    revision: 1,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
}
test("lunar conversion validates real leap months, short months and bounds", () => {
  assert.equal(lunarToSolar(lunar()), "2025-01-29");
  assert.equal(lunarToSolar(lunar({ year: 2026 })), "2026-02-17");
  assert.equal(
    lunarToSolar(lunar({ month: 6, leapMonth: true })),
    "2025-07-25",
  );
  assert.equal(solarToLunar("2025-07-25").leapMonth, true);
  assert.equal(lunarMonths(2025).length, 13);
  assert.equal(lunarDays(2025, -6).length, 29);
  assert.throws(
    () => lunarToSolar(lunar({ month: 6, leapMonth: true, day: 30 })),
    /日期不存在/,
  );
  assert.throws(
    () => lunarToSolar(lunar({ year: 2026, month: 6, leapMonth: true })),
    /日期不存在/,
  );
  assert.throws(() => lunarToSolar(lunar({ year: 1899 })), /年份/);
  assert.throws(() => lunarToSolar(lunar({ year: 2101 })), /年份/);
  assert.throws(
    () => lunarToSolar(lunar({ year: 2100, month: 12, day: 29 })),
    /公历日期/,
  );
});
test("annual lunar recurrence shifts solar date and respects interval, cutoff and anchor", () => {
  const e = event();
  assert.equal(occursOn(e, "2025-01-29"), true);
  assert.equal(occursOn(e, "2026-02-17"), true);
  assert.equal(occursOn(e, "2026-01-29"), false);
  assert.equal(occursOn(e, "2024-02-10"), false);
  assert.equal(
    occursOn(
      { ...e, recurrence: { ...e.recurrence, interval: 2 } },
      "2026-02-17",
    ),
    false,
  );
  assert.equal(
    occursOn(
      { ...e, recurrence: { ...e.recurrence, interval: 2 } },
      "2027-02-06",
    ),
    true,
  );
  assert.equal(
    occursOn(
      { ...e, recurrence: { ...e.recurrence, until: "2026-02-16" } },
      "2026-02-17",
    ),
    false,
  );
  assert.equal(occursOn(e, "2101-01-01"), false);
});
test("regular month birthday does not double in leap month; leap anchor has explicit fallback", () => {
  const ordinary = event(lunar({ month: 6 })),
    leap = event(lunar({ month: 6, leapMonth: true }));
  assert.equal(occursOn(ordinary, "2025-06-25"), true);
  assert.equal(occursOn(ordinary, "2025-07-25"), false);
  assert.equal(occursOn(leap, "2025-07-25"), true);
  assert.equal(occursOn(leap, "2026-07-14"), true);
  assert.equal(
    occursOn(
      { ...leap, lunar: { ...leap.lunar!, leapPolicy: "skip" } },
      "2026-07-14",
    ),
    false,
  );
});
test("lunar monthly intervals count actual leap months and day thirty uses explicit short-month policy", () => {
  const e = event(lunar({ month: 6 }), {
    recurrence: {
      frequency: "monthly",
      interval: 2,
      weekdays: [],
      until: null,
      monthPolicy: "skip",
    },
  });
  assert.equal(occursOn(e, "2025-07-25"), false);
  assert.equal(occursOn(e, "2025-08-23"), true);
  const thirty = event(lunar({ month: 6, day: 30 }), {
    recurrence: { ...e.recurrence, interval: 1 },
  });
  assert.equal(occursOn(thirty, "2025-08-22"), false);
  assert.equal(
    occursOn(
      {
        ...thirty,
        recurrence: { ...thirty.recurrence, monthPolicy: "last_day" },
      },
      "2025-08-22",
    ),
    true,
  );
});
test("lunar occurrence expansion, exceptions and reminders share the converted date", () => {
  const e = event();
  const expanded = expandCalendar(
    e,
    [],
    "2026-01-01",
    "2026-12-31",
    "Asia/Shanghai",
  );
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0]!.occurrenceDate, "2026-02-17");
  assert.equal(expanded[0]!.anniversaryYears, 1);
  const reminders = occurrenceReminders(
    expanded,
    Date.parse("2026-02-01T00:00:00Z"),
  );
  assert.deepEqual(
    reminders.map((r) => r.at),
    ["2026-02-16T01:00:00.000Z", "2026-02-17T01:00:00.000Z"],
  );
  assert.equal(
    expandCalendar(
      e,
      [{ date: "2026-02-17", state: "skipped" }],
      "2026-01-01",
      "2026-12-31",
      "Asia/Shanghai",
    ).length,
    0,
  );
  assert.equal(
    occurrenceReminders(
      expandCalendar(
        e,
        [{ date: "2026-02-17", state: "completed" }],
        "2026-01-01",
        "2026-12-31",
        "Asia/Shanghai",
      ),
      0,
    ).length,
    0,
  );
  const timed = event(lunar(), {
    allDay: false,
    start: "2025-01-29T10:15",
    end: "2025-01-29T11:15",
  });
  assert.equal(
    expandCalendar(timed, [], "2026-02-17", "2026-02-17", "Asia/Shanghai")[0]!
      .startAt,
    "2026-02-17T02:15:00Z",
  );
});
test("anniversary years follow lunar year across Gregorian New Year", () => {
  const e = event(lunar({ year: 2024, month: 12, day: 1 }));
  const next = lunarToSolar(lunar({ year: 2025, month: 12, day: 1 }));
  const occurrence = expandCalendar(e, [], next, next, "Asia/Shanghai")[0]!;
  assert.equal(next.slice(0, 4), "2026");
  assert.equal(e.start.slice(0, 4), "2024");
  assert.equal(occurrence.anniversaryYears, 1);
});
test("event parsing rejects contradictory or malformed lunar anchors and accepts legacy Gregorian input", () => {
  const { id, revision, createdAt, updatedAt, ...e } = event();
  assert.throws(
    () => parseCalendarEvent({ ...e, start: "2025-01-30", end: "2025-01-31" }),
    /不一致/,
  );
  assert.throws(
    () => parseCalendarEvent({ ...e, lunar: { ...e.lunar, leapMonth: "yes" } }),
    /无效/,
  );
  assert.throws(
    () => parseCalendarEvent({ ...e, lunar: { ...e.lunar, day: 0 } }),
    /日期不存在/,
  );
  assert.throws(
    () =>
      parseCalendarEvent({ ...e, lunar: { ...e.lunar, leapPolicy: "guess" } }),
    /无效/,
  );
  assert.throws(
    () => parseCalendarEvent({ ...e, lunar: { ...e.lunar, extra: true } }),
    /未知字段/,
  );
  const { lunar: unused, ...legacy } = e;
  assert.equal(parseCalendarEvent(legacy).lunar, null);
  assert.equal(occursOn({ ...event(), lunar: null }, "2026-01-29"), true);
});
