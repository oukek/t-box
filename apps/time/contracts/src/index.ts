import type { ApplicationClientInteraction } from "@t-box/app-contracts";
import {
  dayjs,
  DateTimeError,
  validTimezone,
  validDate,
  localInstant,
} from "@t-box/dayjs";
import type { ApplicationManifest } from "@t-box/app-contracts";
export const timeManifest = {
  id: "time",
  name: "时间",
  description: "世界时钟、倒计时、秒表与时间换算。",
  icon: "clock",
  color: "blue",
  version: "1.0.0",
  skillIds: ["timekeeping"],
} as const satisfies ApplicationManifest;
export const commonTimezones = [
  ["Asia/Shanghai", "北京 · 上海"],
  ["Asia/Hong_Kong", "香港"],
  ["Asia/Tokyo", "东京"],
  ["Asia/Seoul", "首尔"],
  ["Asia/Singapore", "新加坡"],
  ["Asia/Kolkata", "新德里"],
  ["Asia/Dubai", "迪拜"],
  ["Europe/London", "伦敦"],
  ["Europe/Paris", "巴黎"],
  ["Europe/Berlin", "柏林"],
  ["America/New_York", "纽约"],
  ["America/Chicago", "芝加哥"],
  ["America/Los_Angeles", "洛杉矶"],
  ["Australia/Sydney", "悉尼"],
  ["Pacific/Auckland", "奥克兰"],
  ["UTC", "UTC"],
].map(([value, label]) => ({ value: value!, label: label! }));
export function timeSnapshot(timezone = "Asia/Shanghai", now = new Date()) {
  const zone = validTimezone(timezone),
    z = dayjs(now).tz(zone);
  return {
    instant: z.toISOString().replace(".000Z", "Z"),
    timestampMs: now.getTime(),
    timestampSeconds: Math.floor(now.getTime() / 1000),
    timezone: zone,
    date: z.format("YYYY-MM-DD"),
    time: z.format("HH:mm:ss"),
    local: z.format("YYYY-MM-DDTHH:mm:ss"),
    offset: z.format("Z"),
    weekday: z.isoWeekday(),
    dayOfYear: z.dayOfYear(),
    weekOfYear: z.isoWeek(),
    yearOfWeek: z.isoWeekYear(),
    isLeapYear: z.isLeapYear(),
    daysInMonth: z.daysInMonth(),
  };
}
export type TimeCalculationKind =
  "convert" | "timestamp" | "difference" | "shift";
export function calculateTime(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DateTimeError("时间计算参数无效");
  const args = value as Record<string, unknown>;
  if (
    Object.keys(args).some(
      (k) =>
        ![
          "kind",
          "source",
          "target",
          "value",
          "end",
          "amount",
          "unit",
        ].includes(k),
    )
  )
    throw new DateTimeError("时间计算包含未知字段");
  const source = validTimezone(args.source),
    target = validTimezone(args.target ?? source);
  if (args.kind === "timestamp") {
    if (typeof args.value !== "string" || !/^[-+]?\d{1,16}$/.test(args.value))
      throw new DateTimeError("时间戳应为整数");
    if (!["seconds", "milliseconds"].includes(String(args.unit)))
      throw new DateTimeError("请选择秒或毫秒");
    const ms = Number(args.value) * (args.unit === "seconds" ? 1000 : 1);
    if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).getTime()))
      throw new DateTimeError("时间戳超出范围");
    const result = timeSnapshot(target, new Date(ms));
    validDate(result.date);
    return result;
  }
  const first = localInstant(args.value, source);
  if (args.kind === "convert")
    return timeSnapshot(target, new Date(first.valueOf()));
  if (args.kind === "difference") {
    const end = localInstant(args.end, target),
      milliseconds = end.valueOf() - first.valueOf();
    return {
      milliseconds,
      seconds: milliseconds / 1000,
      minutes: milliseconds / 60000,
      hours: milliseconds / 3600000,
      days: milliseconds / 86400000,
      note: "按实际经过时间计算，夏令时切换的日历日可能不是 24 小时。",
    };
  }
  if (args.kind === "shift") {
    if (
      typeof args.amount !== "string" ||
      !/^[-+]?\d+$/.test(args.amount) ||
      !Number.isSafeInteger(Number(args.amount)) ||
      Math.abs(Number(args.amount)) > 1000000
    )
      throw new DateTimeError("偏移量必须为 −1000000 至 1000000 的整数");
    const amount = Number(args.amount),
      units = [
        "seconds",
        "minutes",
        "hours",
        "days",
        "weeks",
        "months",
        "years",
      ];
    if (!units.includes(String(args.unit)))
      throw new DateTimeError("时间单位无效");
    try {
      const unit = String(args.unit) as import("@t-box/dayjs").ManipulateType;
      const shifted = ["seconds", "minutes", "hours"].includes(unit)
        ? first.add(amount, unit)
        : localInstant(
            dayjs
              .utc(first.tz(source).format("YYYY-MM-DDTHH:mm:ss"))
              .add(amount, unit)
              .format("YYYY-MM-DDTHH:mm:ss"),
            source,
            "compatible",
          );
      const result = timeSnapshot(source, shifted.toDate());
      validDate(result.date);
      return result;
    } catch {
      throw new DateTimeError("偏移后的时间超出范围");
    }
  }
  throw new DateTimeError("时间计算类型无效");
}
export interface TimerInput {
  label: string;
  durationSeconds: number;
}
export interface AppTimer extends TimerInput {
  id: string;
  status: "running" | "paused" | "completed" | "cancelled";
  remainingMs: number;
  deadline: string | null;
  revision: number;
  createdAt: string;
}
export interface TimerState extends TimerInput {
  status: AppTimer["status"];
  remainingMs: number;
  deadline: string | null;
}
export type TimerAction = "pause" | "resume" | "restart" | "cancel";
export function timerState(state: TimerState, now: number): TimerState {
  if (state.status === "running" && state.deadline) {
    const remainingMs = Math.max(0, Date.parse(state.deadline) - now);
    return {
      ...state,
      remainingMs,
      status: remainingMs ? "running" : "completed",
    };
  }
  return { ...state };
}
export function transitionTimer(
  state: TimerState,
  action: TimerAction,
  now: number,
): TimerState {
  const current = timerState(state, now);
  if (action === "restart")
    return {
      ...current,
      status: "running",
      remainingMs: current.durationSeconds * 1000,
      deadline: new Date(now + current.durationSeconds * 1000).toISOString(),
    };
  if (action === "cancel")
    return { ...current, status: "cancelled", remainingMs: 0, deadline: null };
  if (action === "pause" && current.status === "running")
    return { ...current, status: "paused", deadline: null };
  if (action === "resume" && current.status === "paused")
    return {
      ...current,
      status: "running",
      deadline: new Date(now + current.remainingMs).toISOString(),
    };
  throw new DateTimeError("当前倒计时状态不支持此操作");
}
export function parseTimeParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DateTimeError("页面参数无效");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((k) => !["tab", "timezone"].includes(k)))
    throw new DateTimeError("未知页面参数");
  const result: Record<string, string> = {};
  if (args.tab != null) {
    if (!["clock", "timers", "stopwatch", "convert"].includes(String(args.tab)))
      throw new DateTimeError("时间页面不存在");
    result.tab = String(args.tab);
  }
  if (args.timezone != null) result.timezone = validTimezone(args.timezone);
  return result;
}
export {
  dayjs,
  DateTimeError,
  validTimezone,
  validDate,
  localInstant,
} from "@t-box/dayjs";

export const timeClientInteractions = [
  {
    name: "time_reminders_sync",
    title: "同步倒计时提醒",
    purpose: "ui",
    description: "同步当前设备的倒计时提醒；不自动申请通知权限。",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ApplicationClientInteraction[];
