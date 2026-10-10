import { Lunar, LunarMonth, LunarYear, Solar } from "lunar-typescript";
import { dayjs, validDate, DateTimeError } from "@t-box/time-contracts";
import type { CalendarLunarDate, CalendarEventInput } from "./types.js";

export const lunarYearMin = 1900;
export const lunarYearMax = 2100;
const monthCache = new Map<
  number,
  readonly { value: number; label: string; days: number }[]
>();
const dateCache = new Map<string, CalendarLunarDate>();
export function lunarMonths(year: number) {
  if (!Number.isInteger(year) || year < lunarYearMin || year > lunarYearMax)
    throw new DateTimeError("农历年份支持 1900 至 2100 年");
  let months = monthCache.get(year);
  if (!months) {
    months = LunarYear.fromYear(year)
      .getMonthsInYear()
      .map((month) => ({
        value: month.getMonth(),
        label: `${Lunar.fromYmd(year, month.getMonth(), 1).getMonthInChinese()}月`,
        days: month.getDayCount(),
      }));
    monthCache.set(year, months);
  }
  return months;
}
export function lunarDays(year: number, month: number) {
  const selected = lunarMonths(year).find((m) => m.value === month);
  if (!selected) throw new DateTimeError("该农历年份没有所选月份或闰月");
  return Array.from({ length: selected.days }, (_, i) => ({
    value: i + 1,
    label: Lunar.fromYmd(year, month, i + 1).getDayInChinese(),
  }));
}
export function lunarToSolar(value: CalendarLunarDate): string {
  const month = lunarMonths(value.year).find(
    (m) => m.value === (value.leapMonth ? -value.month : value.month),
  );
  if (
    !month ||
    !Number.isInteger(value.day) ||
    value.day < 1 ||
    value.day > month.days
  )
    throw new DateTimeError("农历日期不存在，请检查闰月和当月天数");
  const date = Lunar.fromYmd(value.year, month.value, value.day)
    .getSolar()
    .toYmd();
  if (date < "1900-01-01" || date > "2100-12-31")
    throw new DateTimeError("农历事件对应的公历日期需在 1900 至 2100 年内");
  return date;
}
export function solarToLunar(date: string): CalendarLunarDate {
  validDate(date);
  if (date < "1900-01-01" || date > "2100-12-31")
    throw new DateTimeError("农历事件支持公历 1900 至 2100 年");
  let result = dateCache.get(date);
  if (!result) {
    const d = dayjs.utc(date),
      l = Solar.fromYmd(d.year(), d.month() + 1, d.date()).getLunar();
    result = {
      year: l.getYear(),
      month: Math.abs(l.getMonth()),
      day: l.getDay(),
      leapMonth: l.getMonth() < 0,
      leapPolicy: "regular",
    };
    if (dateCache.size >= 1024)
      dateCache.delete(dateCache.keys().next().value!);
    dateCache.set(date, result);
  }
  return { ...result };
}
export function lunarEventLabel(lunar: CalendarLunarDate): string {
  const l = Lunar.fromYmd(
    lunar.year,
    lunar.leapMonth ? -lunar.month : lunar.month,
    lunar.day,
  );
  return `农历 ${lunar.year}年${l.getMonthInChinese()}月${l.getDayInChinese()}`;
}
function monthlyDistance(anchor: CalendarLunarDate, target: CalendarLunarDate) {
  let months = 0;
  for (let y = anchor.year; y < target.year; y++)
    months += lunarMonths(y).length;
  const index = (d: CalendarLunarDate) =>
    lunarMonths(d.year).findIndex(
      (m) => m.value === (d.leapMonth ? -d.month : d.month),
    );
  return months + index(target) - index(anchor);
}
/** Calendar recurrence is based on lunar years/months; daily and weekly still mean elapsed civil days/weeks. */
export function lunarOccursOn(
  event: CalendarEventInput,
  date: string,
): boolean {
  const a = event.lunar!,
    r = event.recurrence;
  if (date < "1900-01-01" || date > "2100-12-31") return false;
  const d = solarToLunar(date);
  if (d.year < lunarYearMin || d.year > lunarYearMax) return false;
  if (r.frequency === "yearly") {
    if ((d.year - a.year) % r.interval !== 0 || d.month !== a.month)
      return false;
    const hasLeap = lunarMonths(d.year).some((m) => m.value === -a.month);
    const useLeap = a.leapMonth && hasLeap;
    if (a.leapMonth && !hasLeap && a.leapPolicy === "skip") return false;
    if (d.leapMonth !== useLeap) return false;
  } else if (r.frequency === "monthly") {
    if (monthlyDistance(a, d) % r.interval !== 0) return false;
  } else return false;
  const size = LunarMonth.fromYm(
    d.year,
    d.leapMonth ? -d.month : d.month,
  )!.getDayCount();
  return (
    d.day === (r.monthPolicy === "last_day" ? Math.min(a.day, size) : a.day)
  );
}
