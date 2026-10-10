import { APPLICATION_CONTRACT_VERSION } from "@t-box/app-contracts";
import {
  calendarManifest,
  calendarClientInteractions,
  parseCalendarParams,
  lunarLabel,
  calendarObject,
  parseCalendarEvent,
  parseCalendarLunarDate,
  lunarToSolar,
  lunarEventLabel,
  type CalendarEventInput,
} from "@t-box/calendar-contracts";
import { validDate, timeSnapshot } from "@t-box/time-contracts";
import type {
  ApplicationModule,
  ApplicationToolContext,
  ApplicationToolRegistration,
  ResourceAdapter,
} from "@t-box/app-server-sdk";
import { definition, nullable } from "@t-box/app-server-sdk";
import { ApiError } from "@t-box/server-foundation/errors";
import { temporalDomain } from "@t-box/server-foundation/persistence/errors";
import { fingerprint } from "@t-box/server-foundation/persistence/operations";
import type { CalendarService } from "./service.js";
const str = (description: string, maxLength = 200) => ({
  type: "string",
  description,
  maxLength,
});
const eventProperties = {
  title: str("标题", 100),
  description: str("备注", 2000),
  location: str("地点", 200),
  kind: { type: "string", enum: ["event", "anniversary", "birthday", "task"] },
  color: { type: "string", enum: ["teal", "blue", "purple", "orange", "rose"] },
  allDay: { type: "boolean" },
  start: str("全天为 YYYY-MM-DD；指定时间为 YYYY-MM-DDTHH:mm"),
  end: str("全天结束日期不包含当天；指定时间需晚于开始"),
  timezone: str("IANA 时区，未明确时先确认或说明默认使用 Asia/Shanghai", 80),
  lunar: nullable({
    type: "object",
    description:
      "公历事件为 null；农历事件保存原始农历年月日，start 日期必须与其换算结果一致。每年/每月重复按农历计算。",
    properties: {
      year: { type: "integer", minimum: 1900, maximum: 2100 },
      month: { type: "integer", minimum: 1, maximum: 12 },
      day: { type: "integer", minimum: 1, maximum: 30 },
      leapMonth: {
        type: "boolean",
        description: "是否为闰月，该年需实际存在对应闰月",
      },
      leapPolicy: {
        type: "string",
        enum: ["regular", "skip"],
        description:
          "闰月年重复：无对应闰月时用同名普通月或跳过；普通月事件不在闰月再重复",
      },
    },
    required: ["year", "month", "day", "leapMonth", "leapPolicy"],
    additionalProperties: false,
  }),
  recurrence: {
    type: "object",
    properties: {
      frequency: {
        type: "string",
        enum: ["none", "daily", "weekly", "monthly", "yearly"],
      },
      interval: { type: "integer", minimum: 1, maximum: 99 },
      weekdays: {
        type: "array",
        items: { type: "integer", minimum: 1, maximum: 7 },
        maxItems: 7,
      },
      until: nullable(str("重复最后一天 YYYY-MM-DD；不截止为 null")),
      monthPolicy: { type: "string", enum: ["skip", "last_day"] },
    },
    required: ["frequency", "interval", "weekdays", "until", "monthPolicy"],
    additionalProperties: false,
  },
  reminders: {
    type: "array",
    items: { type: "integer", minimum: 0, maximum: 43200 },
    maxItems: 3,
  },
};
const eventSchema = {
  type: "object",
  properties: eventProperties,
  required: Object.keys(eventProperties),
  additionalProperties: false,
};
export function calendarAccessAdapter(
  service: CalendarService,
): ResourceAdapter {
  return {
    appId: "calendar",
    async inspect(actor, resource, action) {
      if (
        resource.resourceType !== "event" ||
        !["read", "write"].includes(action)
      )
        throw new ApiError(400, "INVALID_SCOPE", "不支持的日历资源");
      await service.get(actor.user.id, resource.resourceId);
      return {};
    },
  };
}
export function createCalendarModule(
  service?: CalendarService,
): ApplicationModule {
  const actor = (ctx: ApplicationToolContext) => {
    if (!service || !ctx.actor)
      throw new ApiError(503, "CALENDAR_UNAVAILABLE", "请登录后使用日历");
    ctx.signal.throwIfAborted();
    return ctx.actor.user.id;
  };
  const args = (value: unknown, fields: string[]) =>
    temporalDomain(() => calendarObject(value, fields));
  const sync = async (ctx: ApplicationToolContext) => {
    try {
      const result = await ctx.interact({
        name: "calendar_reminders_sync",
        arguments: {},
        timeoutMs: 5000,
        optional: true,
      });
      return result.ok ? result.data : { synced: false };
    } catch {
      return {
        synced: false,
        note: "数据已保存，本机提醒未同步。打开日历检查提醒权限。",
      };
    }
  };
  const tools: Record<string, ApplicationToolRegistration> = {};
  const read = (
    name: string,
    title: string,
    properties: Record<string, Record<string, unknown>>,
    handler: ApplicationToolRegistration["handler"],
  ) => {
    tools[name] = {
      title,
      definition: definition(name, title, properties),
      execution: "server",
      effect: "read",
      successSummary: `已${title}`,
      handler,
    };
  };
  read(
    "calendar_today",
    "获取今天日期及农历",
    { timezone: nullable(str("IANA 时区，null 默认 Asia/Shanghai", 80)) },
    async (value, ctx) => {
      actor(ctx);
      const a = args(value, ["timezone"]),
        now = temporalDomain(() =>
          timeSnapshot(a.timezone == null ? undefined : String(a.timezone)),
        );
      return {
        ...now,
        lunar: lunarLabel(now.date),
        almanac: await service!.holidays.dateInfo(now.date),
      };
    },
  );
  read(
    "calendar_date_info",
    "查询指定日期的农历、节气、节日及已公布的中国大陆放假调休安排",
    { date: str("公历日期 YYYY-MM-DD；农历信息支持 1900–2100 年") },
    async (value, ctx) => {
      actor(ctx);
      const a = args(value, ["date"]);
      return service!.holidays.dateInfo(
        temporalDomain(() => validDate(a.date)),
      );
    },
  );
  read(
    "calendar_lunar_to_solar",
    "将农历年月日换算为公历（创建农历事件前使用）",
    {
      year: { type: "integer", minimum: 1900, maximum: 2100 },
      month: { type: "integer", minimum: 1, maximum: 12 },
      day: { type: "integer", minimum: 1, maximum: 30 },
      leapMonth: { type: "boolean" },
    },
    async (value, ctx) => {
      actor(ctx);
      const a = args(value, ["year", "month", "day", "leapMonth"]);
      const lunar = temporalDomain(() =>
        parseCalendarLunarDate({ ...a, leapPolicy: "regular" }),
      );
      return {
        date: lunarToSolar(lunar),
        lunar,
        label: lunarEventLabel(lunar),
      };
    },
  );
  read(
    "calendar_events_list",
    "搜索日历事件（包含真实 ID 与版本）",
    { search: nullable(str("标题、地点或备注关键词，null 为全部", 100)) },
    async (value, ctx) => {
      const uid = actor(ctx),
        a = args(value, ["search"]);
      return service!.events(uid, a.search == null ? "" : String(a.search));
    },
  );
  read(
    "calendar_occurrences",
    "查询日期范围内的具体日程",
    {
      from: str("开始日期 YYYY-MM-DD"),
      to: str("结束日期 YYYY-MM-DD，范围最多 371 天"),
      timezone: str("查看时区", 80),
      search: nullable(str("搜索关键词", 100)),
      kind: nullable({
        type: "string",
        enum: ["event", "anniversary", "birthday", "task"],
      }),
    },
    async (value, ctx) => service!.occurrences(actor(ctx), value),
  );
  read(
    "calendar_event_get",
    "读取日历事件详情",
    { id: str("实际事件 ID", 36) },
    async (value, ctx) => {
      const uid = actor(ctx),
        a = args(value, ["id"]);
      return service!.get(uid, String(a.id));
    },
  );
  const write = (
    name: string,
    title: string,
    properties: Record<string, Record<string, unknown>>,
    handler: ApplicationToolRegistration["handler"],
  ) => {
    tools[name] = {
      title,
      definition: definition(name, title, properties),
      execution: "server",
      effect: "write",
      writeFingerprint: fingerprint,
      successSummary: `已${title}`,
      handler,
    };
  };
  write(
    "calendar_event_create",
    "创建日程、纪念日或生日",
    eventProperties,
    async (value, ctx) => {
      const uid = actor(ctx),
        input = temporalDomain(() => parseCalendarEvent(value)),
        event = await service!.create(
          uid,
          fingerprint([ctx.requestId, "create", input]),
          input,
        );
      return { event, deviceReminder: await sync(ctx) };
    },
  );
  write(
    "calendar_event_update",
    "修改整个日程（读取最新版本后调用）",
    {
      id: str("实际事件 ID", 36),
      revision: { type: "integer", minimum: 1 },
      event: eventSchema,
    },
    async (value, ctx) => {
      const uid = actor(ctx),
        a = args(value, ["id", "revision", "event"]),
        event = await service!.update(
          uid,
          String(a.id),
          fingerprint([ctx.requestId, "update", a]),
          { revision: a.revision, event: a.event },
        );
      return { event, deviceReminder: await sync(ctx) };
    },
  );
  write(
    "calendar_event_delete",
    "删除整个日程或重复系列（用户确认后）",
    { id: str("实际事件 ID", 36), revision: { type: "integer", minimum: 1 } },
    async (value, ctx) => {
      const uid = actor(ctx),
        a = args(value, ["id", "revision"]),
        result = await service!.remove(
          uid,
          String(a.id),
          fingerprint([ctx.requestId, "delete", a]),
          { revision: a.revision },
        );
      return { ...result, deviceReminder: await sync(ctx) };
    },
  );
  tools.calendar_event_delete!.confirm = async (value, ctx) => {
    const uid = actor(ctx),
      a = args(value, ["id", "revision"]),
      event = await service!.get(uid, String(a.id));
    return {
      name: "calendar_confirm",
      arguments: {
        title: "删除日历事件",
        message: `删除“${event.title}”${event.recurrence.frequency === "none" ? "" : "及其全部重复日程"}？此操作不能撤销。`,
      },
    };
  };
  write(
    "calendar_occurrence_state",
    "完成、跳过或恢复某一次日程",
    {
      id: str("实际事件 ID", 36),
      revision: { type: "integer", minimum: 1 },
      date: str("该次 occurrenceDate，不是查看时区日期"),
      state: { type: "string", enum: ["completed", "skipped", "normal"] },
    },
    async (value, ctx) => {
      const uid = actor(ctx),
        a = args(value, ["id", "revision", "date", "state"]),
        event = await service!.occurrenceState(
          uid,
          String(a.id),
          fingerprint([ctx.requestId, "state", a]),
          { revision: a.revision, date: a.date, state: a.state },
        );
      return { event, deviceReminder: await sync(ctx) };
    },
  );
  for (const name of [
    "calendar_event_get",
    "calendar_event_update",
    "calendar_event_delete",
    "calendar_occurrence_state",
  ])
    tools[name]!.resources = (value, ctx) => {
      actor(ctx);
      const a = args(
        value,
        Object.keys(tools[name]!.definition.parameters.properties as object),
      );
      return [
        {
          resource: {
            appId: "calendar",
            resourceType: "event",
            resourceId: String(a.id),
          },
          action: tools[name]!.effect === "read" ? "read" : "write",
        },
      ];
    };
  return {
    id: "calendar",
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: calendarManifest,
    interactions: calendarClientInteractions,
    tools,
    skills: {
      calendar_planning: {
        title: "日程与纪念日",
        description: "查询和管理私人事件、重复日程、生日、纪念日及单次状态。",
        version: "1.0.0",
        tools: Object.keys(tools),
        instructions:
          "先 calendar_today 获取真实日期，不凭模型知识猜今天。指定日期的农历、节气与节日使用 calendar_date_info；农历支持 1900–2100 年。创建农历事件须保存 lunar 原始年月日，用 calendar_lunar_to_solar 获取实际公历 start，不能只换算一次后创建公历年重复。未明确公历/农历和出生年份先询问；闰月年重复遇到无对应闰月按 leapPolicy，农历三十遇小月按 monthPolicy，向用户说明。每月重复包含实际闰月；每天每周按自然日/周计算。节日不代表放假，放假调休只依据 arrangement，scheduleKnown 为 false 表示该年度安排尚未收录。事件仅属于当前登录用户。操作前读取真实 ID 与最新 revision。全天事件 end 为排他结束日期；定时事件明确 IANA 时区。纪念日与生日默认建议每年，但须按用户意愿。缺失时间、时区或重复规则询问，不编造。创建后 app_open 打开 calendar 对应日期。删除整个系列必须前端确认；完成或跳过只影响 occurrenceDate。系统提醒仅在当前设备已授权且同步成功后才可说已启用，否则说明只保存了提醒设置。",
      },
    },
    agents: [
      {
        id: "calendar",
        title: "日程助手",
        description: "规划日程、纪念日与重复事件",
        version: "1.0.0",
        skillIds: ["calendar_planning"],
        instructions:
          "按照实际当前日期和明确时区安排日程；检查时间冲突但不擅自覆盖现有事件。缺失关键信息先询问。区分单次状态与整个系列，不声称已同步第三方日历。",
      },
    ],
    ...(service ? { access: calendarAccessAdapter(service) } : {}),
    navigation: {
      properties: {
        date: nullable(str("YYYY-MM-DD")),
        view: nullable({
          type: "string",
          enum: ["month", "agenda", "anniversaries"],
        }),
        eventId: nullable(str("事件 ID", 36)),
      },
      parse: (value) => temporalDomain(() => parseCalendarParams(value)),
    },
  };
}
