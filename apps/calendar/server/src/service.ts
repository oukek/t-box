import { HolidayService } from "./holiday-service.js";
import { randomUUID } from "node:crypto";
import { In, type DataSource, type EntityManager } from "typeorm";
import {
  calendarObject,
  parseCalendarEvent,
  expandCalendar,
  occursOn,
  occurrenceReminders,
  type CalendarEvent,
  type CalendarOccurrence,
} from "@t-box/calendar-contracts";
import {
  validDate,
  validTimezone,
  timeSnapshot,
  dayjs,
} from "@t-box/time-contracts";
import { ApiError } from "@t-box/server-foundation/errors";
import { parseId } from "@t-box/server-foundation/validation";
import {
  CalendarEventEntity,
  CalendarExceptionEntity,
  type StoredCalendarEvent,
} from "./entity.js";
import {
  mutateApplication,
  stableJson,
} from "@t-box/server-foundation/persistence/operations";
import {
  temporalDomain,
  revision,
} from "@t-box/server-foundation/persistence/errors";
const view = (row: StoredCalendarEvent): CalendarEvent => ({
  ...row.data,
  lunar: row.data.lunar ?? null,
  id: row.id,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
export class CalendarService {
  readonly holidays: HolidayService;
  constructor(
    private readonly source: DataSource,
    settingsCache?: {
      read<T>(
        scope: string,
        revision: string,
        load: () => Promise<T>,
      ): Promise<T>;
    },
  ) {
    this.holidays = new HolidayService(source, undefined, settingsCache);
  }
  async get(
    userId: string,
    id: string,
    db: EntityManager = this.source.manager,
  ) {
    const row = await db
      .getRepository(CalendarEventEntity)
      .findOneBy({ id: parseId(id), userId, deleted: false });
    if (!row)
      throw new ApiError(
        404,
        "CALENDAR_EVENT_NOT_FOUND",
        "事件不存在或无权访问",
      );
    return view(row);
  }
  async states(userId: string, id: string) {
    await this.get(userId, id);
    return this.source
      .getRepository(CalendarExceptionEntity)
      .find({ where: { eventId: id }, order: { date: "DESC" } });
  }
  async events(userId: string, search = "") {
    if (typeof search !== "string" || search.length > 100)
      throw new ApiError(400, "INVALID_SEARCH", "搜索关键词最多 100 个字符");
    const rows = await this.source.getRepository(CalendarEventEntity).find({
      where: { userId, deleted: false },
      order: { createdAt: "DESC" },
      take: 1001,
    });
    if (rows.length > 1000)
      throw new ApiError(409, "CALENDAR_LIMIT", "事件数量超出当前应用容量");
    return rows
      .filter(
        (row) =>
          !search ||
          [row.data.title, row.data.description, row.data.location].some((s) =>
            s.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          ),
      )
      .map(view);
  }
  async occurrences(userId: string, value: unknown) {
    const q = temporalDomain(() =>
        calendarObject(value, ["from", "to", "timezone", "search", "kind"]),
      ),
      from = temporalDomain(() => validDate(q.from)),
      to = temporalDomain(() => validDate(q.to)),
      timezone = temporalDomain(() => validTimezone(q.timezone));
    temporalDomain(() => {
      const days = dayjs.utc(to).diff(dayjs.utc(from), "day");
      if (days < 0 || days > 370)
        throw new ApiError(400, "INVALID_RANGE", "查询范围需为 0 至 370 天");
    });
    if (
      q.kind != null &&
      !["event", "anniversary", "birthday", "task"].includes(String(q.kind))
    )
      throw new ApiError(400, "INVALID_KIND", "事件类型无效");
    const events = (
      await this.events(userId, q.search == null ? "" : String(q.search))
    ).filter((e) => q.kind == null || e.kind === q.kind);
    const exceptions = events.length
      ? await this.source
          .getRepository(CalendarExceptionEntity)
          .findBy({ eventId: In(events.map((e) => e.id)) })
      : [];
    let result: CalendarOccurrence[] = [];
    let truncated = false;
    for (const event of events) {
      const expanded = temporalDomain(() =>
        expandCalendar(
          event,
          exceptions.filter((e) => e.eventId === event.id),
          from,
          to,
          timezone,
        ),
      );
      if (result.length + expanded.length > 5000) truncated = true;
      // Keep the earliest global instances, including older series, with bounded memory.
      const merged: CalendarOccurrence[] = [];
      let i = 0,
        j = 0;
      while (
        merged.length < 5000 &&
        (i < result.length || j < expanded.length)
      ) {
        if (
          j >= expanded.length ||
          (i < result.length &&
            result[i]!.startAt.localeCompare(expanded[j]!.startAt) <= 0)
        )
          merged.push(result[i++]!);
        else merged.push(expanded[j++]!);
      }
      result = merged;
    }
    return {
      occurrences: result.sort((a, b) => a.startAt.localeCompare(b.startAt)),
      truncated,
      timezone,
      from,
      to,
    };
  }
  create(userId: string, key: unknown, value: unknown) {
    const input = temporalDomain(() => parseCalendarEvent(value));
    return mutateApplication(
      this.source,
      userId,
      "calendar",
      "create",
      key,
      input,
      async (db) => {
        const repo = db.getRepository(CalendarEventEntity);
        if ((await repo.countBy({ userId, deleted: false })) >= 1000)
          throw new ApiError(
            409,
            "CALENDAR_LIMIT",
            "最多保留 1000 个事件，请先整理旧事件",
          );
        const now = new Date(),
          row = {
            id: randomUUID(),
            userId,
            title: input.title,
            data: input,
            revision: 1,
            deleted: false,
            createdAt: now,
            updatedAt: now,
          };
        await repo.insert(row);
        return view(row);
      },
    );
  }
  update(userId: string, id: string, key: unknown, value: unknown) {
    const raw = temporalDomain(() =>
        calendarObject(value, ["revision", "event"]),
      ),
      version = revision(raw.revision),
      input = temporalDomain(() => parseCalendarEvent(raw.event));
    parseId(id);
    return mutateApplication(
      this.source,
      userId,
      "calendar",
      `update:${id}`,
      key,
      { revision: version, event: input },
      async (db) => {
        const previous = await this.get(userId, id, db);
        const result = await db.getRepository(CalendarEventEntity).update(
          { id, userId, revision: version, deleted: false },
          {
            data: input,
            title: input.title,
            revision: version + 1,
            updatedAt: new Date(),
          },
        );
        if (!result.affected)
          throw new ApiError(409, "STALE_REVISION", "事件已更新，请刷新后重试");
        if (
          ["allDay", "start", "end", "timezone", "recurrence", "lunar"].some(
            (k) =>
              stableJson(previous[k as keyof CalendarEvent]) !==
              stableJson(input[k as keyof typeof input]),
          )
        ) {
          await db
            .getRepository(CalendarExceptionEntity)
            .delete({ eventId: id });
        }
        return this.get(userId, id, db);
      },
    );
  }
  remove(userId: string, id: string, key: unknown, value: unknown) {
    const raw = temporalDomain(() => calendarObject(value, ["revision"])),
      version = revision(raw.revision);
    parseId(id);
    return mutateApplication(
      this.source,
      userId,
      "calendar",
      `delete:${id}`,
      key,
      { revision: version },
      async (db) => {
        await this.get(userId, id, db);
        const result = await db
          .getRepository(CalendarEventEntity)
          .update(
            { id, userId, revision: version, deleted: false },
            { deleted: true, revision: version + 1, updatedAt: new Date() },
          );
        if (!result.affected)
          throw new ApiError(409, "STALE_REVISION", "事件已更新，请刷新后重试");
        return { deleted: true, id };
      },
    );
  }
  occurrenceState(userId: string, id: string, key: unknown, value: unknown) {
    const raw = temporalDomain(() =>
        calendarObject(value, ["revision", "date", "state"]),
      ),
      version = revision(raw.revision),
      date = temporalDomain(() => validDate(raw.date));
    parseId(id);
    if (!["skipped", "completed", "normal"].includes(String(raw.state)))
      throw new ApiError(400, "INVALID_OCCURRENCE_STATE", "事件状态无效");
    return mutateApplication(
      this.source,
      userId,
      "calendar",
      `occurrence:${id}`,
      key,
      { revision: version, date, state: raw.state },
      async (db) => {
        const event = await this.get(userId, id, db);
        if (!temporalDomain(() => occursOn(event, date)))
          throw new ApiError(400, "OCCURRENCE_NOT_FOUND", "此日期没有该事件");
        const result = await db
          .getRepository(CalendarEventEntity)
          .update(
            { id, userId, revision: version, deleted: false },
            { revision: version + 1, updatedAt: new Date() },
          );
        if (!result.affected)
          throw new ApiError(409, "STALE_REVISION", "事件已更新，请刷新后重试");
        const repo = db.getRepository(CalendarExceptionEntity);
        if (raw.state === "normal") await repo.delete({ eventId: id, date });
        else
          await repo.save({
            eventId: id,
            date,
            state: raw.state as "skipped" | "completed",
          });
        return this.get(userId, id, db);
      },
    );
  }
  async reminders(userId: string, timezone = "Asia/Shanghai") {
    const now = new Date(),
      today = temporalDomain(() => timeSnapshot(timezone, now).date),
      end = dayjs.utc(today).add(180, "day").format("YYYY-MM-DD");
    const result = await this.occurrences(userId, {
      from: dayjs.utc(today).subtract(1, "day").format("YYYY-MM-DD"),
      to: end,
      timezone,
    });
    const reminders = occurrenceReminders(
      result.occurrences,
      now.getTime() - 10 * 60000,
    );
    return {
      reminders: reminders.slice(0, 500),
      truncated: result.truncated || reminders.length > 500,
      serverNow: now.toISOString(),
    };
  }
}
