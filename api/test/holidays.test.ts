import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHolidayDataset,
  holidayArrangement,
  holidayScheduleKnown,
  calendarWeekStart,
  calendarWeekRange,
  calendarWeekdays,
  calendarDayInfo,
  type HolidayYearSnapshot,
} from "@t-box/calendar-contracts";
const data = {
  year: 2026,
  papers: ["https://www.gov.cn/zhengce/2026.htm"],
  days: [{ date: "2026-10-01", name: "国庆节", status: "rest" }],
};
test("holiday datasets reject bad sources, duplicates, cross-year overflow and incomplete publication", () => {
  assert.equal(parseHolidayDataset(data).days[0]!.date, "2026-10-01");
  for (const papers of [
    ["https://gov.cn.attacker.test/fake"],
    ["javascript:alert(1)"],
    ["https://user:pass@www.gov.cn/x"],
    [],
  ])
    assert.throws(() => parseHolidayDataset({ ...data, papers }));
  assert.throws(() =>
    parseHolidayDataset({ ...data, days: [...data.days, ...data.days] }),
  );
  assert.throws(() =>
    parseHolidayDataset({
      ...data,
      days: [{ ...data.days[0], date: "2025-11-30" }],
    }),
  );
  assert.throws(() =>
    parseHolidayDataset({
      ...data,
      days: [{ ...data.days[0], date: "2026-02-29" }],
    }),
  );
  assert.throws(() => parseHolidayDataset(data, true));
});
test("adjacent-year notice takes precedence and unpublished candidates do not imply a schedule", () => {
  const first: HolidayYearSnapshot = {
    region: "CN",
    year: 2026,
    revision: 1,
    publishedAt: null,
    data: {
      ...data,
      days: [{ date: "2026-12-31", name: "元旦", status: "rest" }],
    },
  };
  const next: HolidayYearSnapshot = {
    region: "CN",
    year: 2027,
    revision: 2,
    publishedAt: null,
    data: {
      year: 2027,
      papers: data.papers,
      days: [{ date: "2026-12-31", name: "元旦", status: "work" }],
    },
  };
  assert.equal(holidayArrangement("2026-12-31", [next, first])?.status, "work");
  assert.equal(holidayScheduleKnown(2026, [first]), true);
  assert.equal(holidayScheduleKnown(2027, [{ ...next, data: null }]), false);
  assert.equal(calendarDayInfo("2026-10-01").arrangement, null);
  assert.ok(calendarDayInfo("2026-10-01").festivals.includes("国庆节"));
});
test("calendar view starts Sunday while stored recurrence weekday IDs stay ISO-compatible", () => {
  assert.equal(calendarWeekStart("2026-10-07"), "2026-10-04");
  assert.equal(calendarWeekStart("2026-10-04"), "2026-10-04");
  assert.deepEqual(
    calendarWeekdays.map((d) => d.value),
    [7, 1, 2, 3, 4, 5, 6],
  );
  assert.equal(calendarWeekStart("2026-01-01"), "2025-12-28");
});

test("Sunday-first week queries clamp supported date boundaries", () => {
  assert.deepEqual(calendarWeekRange("1900-01-01"), {
    from: "1900-01-01",
    to: "1900-01-06",
  });
  assert.deepEqual(calendarWeekRange("9999-12-31"), {
    from: "9999-12-26",
    to: "9999-12-31",
  });
});
