import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDataSource } from "../src/db/data-source.js";
import { PlatformService } from "../src/platform/service.js";
import { createApp } from "../src/app.js";
import { cleanupUsers } from "./fixtures.js";
import { createCalendarModule } from "@t-box/calendar-server/module";
import { createTimeModule } from "@t-box/time-server/module";
import type { ApplicationToolContext } from "../src/application-sdk/contracts.js";
const source = await createDataSource().initialize(),
  p = new PlatformService(source),
  app = createApp({
    platform: p,
    bills: {} as any,
    logger: { level: "error" },
    health: async () => ({ mysql: "up", redis: "disabled" }),
  }),
  ids: string[] = [];
async function call(
  method: any,
  url: string,
  token = "",
  payload?: unknown,
  status = 200,
  key = randomUUID(),
) {
  const reply = await app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "Idempotency-Key": key,
    },
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
  assert.equal(
    reply.statusCode,
    status,
    `${method} ${url}: ${reply.statusCode === status ? "" : reply.body}`,
  );
  return reply.json().data;
}
try {
  const users = [];
  for (let i = 0; i < 2; i++) {
    const u = await call(
      "POST",
      "/api/v1/auth/register",
      "",
      {
        username: `test_temporal_${randomUUID().replaceAll("-", "")}`,
        password: "test123",
        nickname: "临时验证",
      },
      201,
    );
    ids.push(u.user.id);
    users.push(u);
  }
  const [a, b] = users,
    key = randomUUID(),
    input = {
      title: "每周复盘",
      description: "测试专用",
      location: "",
      kind: "event",
      color: "teal",
      allDay: false,
      start: "2026-10-06T09:00",
      end: "2026-10-06T10:00",
      timezone: "Asia/Shanghai",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [2],
        until: null,
        monthPolicy: "skip",
      },
      reminders: [15],
    };
  await call("GET", "/api/v1/calendar/events", "", undefined, 401);
  await call(
    "GET",
    "/api/v1/calendar/date-info?date=2026-10-01",
    "",
    undefined,
    401,
  );
  const info = await call(
    "GET",
    "/api/v1/calendar/date-info?date=2026-10-01",
    a.token,
  );
  assert.ok(info.festivals.includes("国庆节"));
  assert.equal(info.arrangement.status, "rest");
  await call(
    "GET",
    "/api/v1/calendar/date-info?date=2026-02-29",
    a.token,
    undefined,
    400,
  );
  const [e, replay] = await Promise.all([
    call("POST", "/api/v1/calendar/events", a.token, input, 201, key),
    call("POST", "/api/v1/calendar/events", a.token, input, 201, key),
  ]);
  assert.equal(e.id, replay.id);
  assert.equal(
    (await call("GET", "/api/v1/calendar/events", a.token)).length,
    1,
  );
  await call(
    "POST",
    "/api/v1/calendar/events",
    a.token,
    { ...input, title: "换内容" },
    409,
    key,
  );
  await call("GET", `/api/v1/calendar/events/${e.id}`, b.token, undefined, 404);
  await call(
    "PATCH",
    `/api/v1/calendar/events/${e.id}`,
    b.token,
    { revision: 1, event: input },
    404,
  );
  let v = await call(
    "POST",
    `/api/v1/calendar/events/${e.id}/occurrence-state`,
    a.token,
    { revision: 1, date: "2026-10-06", state: "completed" },
  );
  assert.equal(v.revision, 2);
  v = await call("PATCH", `/api/v1/calendar/events/${e.id}`, a.token, {
    revision: 2,
    event: { ...input, title: "周复盘（改名）" },
  });
  assert.equal(v.revision, 3);
  let occurrences = (
    await call(
      "GET",
      "/api/v1/calendar/occurrences?from=2026-10-06&to=2026-10-13&timezone=Asia%2FShanghai",
      a.token,
    )
  ).occurrences;
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].completed, true);
  await call(
    "PATCH",
    `/api/v1/calendar/events/${e.id}`,
    a.token,
    { revision: 1, event: input },
    409,
  );
  v = await call(
    "POST",
    `/api/v1/calendar/events/${e.id}/occurrence-state`,
    a.token,
    { revision: 3, date: "2026-10-13", state: "skipped" },
  );
  assert.equal(v.revision, 4);
  assert.equal(
    (
      await call(
        "GET",
        "/api/v1/calendar/occurrences?from=2026-10-06&to=2026-10-13&timezone=Asia%2FShanghai",
        a.token,
      )
    ).occurrences.length,
    1,
  );
  v = await call("PATCH", `/api/v1/calendar/events/${e.id}`, a.token, {
    revision: 4,
    event: { ...input, start: "2026-10-06T11:00", end: "2026-10-06T12:00" },
  });
  assert.equal(v.revision, 5);
  occurrences = (
    await call(
      "GET",
      "/api/v1/calendar/occurrences?from=2026-10-06&to=2026-10-13&timezone=Asia%2FShanghai",
      a.token,
    )
  ).occurrences;
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].completed, false);
  await call(
    "GET",
    "/api/v1/calendar/occurrences?from=2026-10-06&to=2026-10-13&timezone=UTC&kind=wrong",
    a.token,
    undefined,
    400,
  );
  const snapshot = await call(
    "GET",
    "/api/v1/time/now?timezone=Pacific%2FAuckland",
    a.token,
  );
  assert.equal(snapshot.timezone, "Pacific/Auckland");
  assert.ok(Math.abs(Date.now() - snapshot.timestampMs) < 1000);
  assert.equal(
    (
      await call("POST", "/api/v1/time/calculations", a.token, {
        kind: "convert",
        source: "Asia/Shanghai",
        target: "UTC",
        value: "2026-10-06T08:00",
      })
    ).local,
    "2026-10-06T00:00:00",
  );
  const tk = randomUUID(),
    timerInput = { label: "专注", durationSeconds: 90 },
    [t, t2] = await Promise.all([
      call("POST", "/api/v1/time/timers", a.token, timerInput, 201, tk),
      call("POST", "/api/v1/time/timers", a.token, timerInput, 201, tk),
    ]);
  assert.equal(t.id, t2.id);
  await call(
    "POST",
    `/api/v1/time/timers/${t.id}/actions`,
    b.token,
    { revision: 1, action: "pause" },
    404,
  );
  const paused = await call(
    "POST",
    `/api/v1/time/timers/${t.id}/actions`,
    a.token,
    { revision: 1, action: "pause" },
  );
  assert.equal(paused.status, "paused");
  assert.ok(paused.remainingMs <= 90000 && paused.remainingMs > 85000);
  assert.equal(paused.deadline, null);
  await call(
    "POST",
    `/api/v1/time/timers/${t.id}/actions`,
    a.token,
    { revision: 1, action: "restart" },
    409,
  );
  const resumed = await call(
    "POST",
    `/api/v1/time/timers/${t.id}/actions`,
    a.token,
    { revision: 2, action: "resume" },
  );
  assert.equal(resumed.status, "running");
  assert.ok(resumed.deadline);
  const ctx: ApplicationToolContext = {
    actor: { user: a.user, sessionHash: "fixture" },
    bindings: [],
    requestId: "fixture-calendar-tool",
    signal: new AbortController().signal,
    interact: async () => {
      throw new Error("frontend unavailable");
    },
    session: { messages: [] },
    use: async (_key, fn) => fn(),
  };
  const calendar = createCalendarModule(p.calendar),
    time = createTimeModule(p.time);
  const almanac: any = await calendar.tools.calendar_date_info!.handler!(
    { date: "2026-10-10" },
    ctx,
  );
  assert.equal(almanac.arrangement.status, "work");
  const todayInfo: any = await calendar.tools.calendar_today!.handler!(
    { timezone: "Asia/Shanghai" },
    ctx,
  );
  assert.equal(todayInfo.almanac.date, todayInfo.date);
  const created: any = await calendar.tools.calendar_event_create!.handler!(
    input,
    ctx,
  );
  assert.equal(created.deviceReminder.synced, false);
  assert.ok(created.event.id);
  const replayTool: any = await calendar.tools.calendar_event_create!.handler!(
    input,
    ctx,
  );
  assert.equal(replayTool.event.id, created.event.id);
  await assert.rejects(
    calendar.access!.inspect(
      { ...ctx.actor!, user: b.user },
      {
        appId: "calendar",
        resourceType: "event",
        resourceId: created.event.id,
      },
      "read",
      "测试",
    ),
    /无权/,
  );
  assert.equal(
    (
      await calendar.tools.calendar_event_delete!.confirm!(
        { id: created.event.id, revision: 1 },
        ctx,
      )
    ).name,
    "calendar_confirm",
  );
  const toolTimer: any = await time.tools.time_timer_create!.handler!(
    { label: "工具计时", durationSeconds: 10 },
    ctx,
  );
  assert.equal(toolTimer.deviceReminder.synced, false);
  await call("DELETE", `/api/v1/time/timers/${t.id}`, a.token, { revision: 3 });
  assert.equal(
    (await call("GET", "/api/v1/time/timers", a.token)).timers.length,
    1,
  );
  await call("DELETE", `/api/v1/calendar/events/${e.id}`, a.token, {
    revision: v.revision,
  });
  await call("GET", `/api/v1/calendar/events/${e.id}`, a.token, undefined, 404);
  for (const id of ["calendar", "time"]) {
    const catalog = await call(
      "GET",
      `/api/v1/applications/${id}/capabilities`,
      a.token,
    );
    assert.ok(catalog.tools.length);
    assert.ok(catalog.agents.length);
  }
  const conversion: any = await calendar.tools.calendar_lunar_to_solar!
    .handler!({ year: 2025, month: 1, day: 1, leapMonth: false }, ctx);
  assert.equal(conversion.date, "2025-01-29");
  const lunarInput = {
    ...input,
    title: "农历生日验证",
    kind: "birthday",
    allDay: true,
    start: conversion.date,
    end: "2025-01-30",
    lunar: conversion.lunar,
    recurrence: {
      frequency: "yearly",
      interval: 1,
      weekdays: [],
      until: null,
      monthPolicy: "last_day",
    },
    reminders: [1440],
  };
  const lunarEvent = await call(
    "POST",
    "/api/v1/calendar/events",
    a.token,
    lunarInput,
    201,
  );
  assert.deepEqual(
    (await call("GET", `/api/v1/calendar/events/${lunarEvent.id}`, a.token))
      .lunar,
    conversion.lunar,
  );
  await call(
    "GET",
    `/api/v1/calendar/events/${lunarEvent.id}`,
    b.token,
    undefined,
    404,
  );
  await call(
    "POST",
    "/api/v1/calendar/events",
    a.token,
    { ...lunarInput, start: "2025-01-30", end: "2025-01-31" },
    400,
  );
  const lunarOccurrences = await call(
    "GET",
    "/api/v1/calendar/occurrences?from=2026-02-01&to=2026-02-28&timezone=Asia%2FShanghai",
    a.token,
  );
  assert.equal(
    lunarOccurrences.occurrences.find((o: any) => o.event.id === lunarEvent.id)
      .occurrenceDate,
    "2026-02-17",
  );
  const completedLunar = await call(
    "POST",
    `/api/v1/calendar/events/${lunarEvent.id}/occurrence-state`,
    a.token,
    { revision: 1, date: "2026-02-17", state: "completed" },
  );
  const renamedLunar = await call(
    "PATCH",
    `/api/v1/calendar/events/${lunarEvent.id}`,
    a.token,
    {
      revision: completedLunar.revision,
      event: { ...lunarInput, title: "农历生日改名" },
    },
  );
  assert.equal((await p.calendar.states(a.user.id, lunarEvent.id)).length, 1);
  await call("PATCH", `/api/v1/calendar/events/${lunarEvent.id}`, a.token, {
    revision: renamedLunar.revision,
    event: {
      ...lunarInput,
      lunar: { ...conversion.lunar, leapPolicy: "skip" },
    },
  });
  assert.equal((await p.calendar.states(a.user.id, lunarEvent.id)).length, 0);
  const lunarTool: any = await calendar.tools.calendar_event_create!.handler!(
    lunarInput,
    { ...ctx, requestId: "fixture-lunar-tool" },
  );
  assert.deepEqual(lunarTool.event.lunar, conversion.lunar);
  assert.equal(lunarTool.deviceReminder.synced, false);
  console.info(
    "Calendar/time REST + MySQL + ownership + optimistic versions + concurrent idempotency + persisted exceptions + lunar events + AI module integration passed.",
  );
} finally {
  await app.close();
  await cleanupUsers(source, ids);
  await source.destroy();
}
