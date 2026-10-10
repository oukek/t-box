import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { calendarObject } from "@t-box/calendar-contracts";
import {
  timerState,
  transitionTimer,
  type AppTimer,
  type TimerInput,
  type TimerAction,
} from "@t-box/time-contracts";
import { ApiError } from "@t-box/server-foundation/errors";
import { parseId } from "@t-box/server-foundation/validation";
import { TimerEntity, type StoredTimer } from "./entity.js";
import {
  temporalDomain,
  revision,
} from "@t-box/server-foundation/persistence/errors";
import { mutateApplication } from "@t-box/server-foundation/persistence/operations";
const view = (row: StoredTimer, now = Date.now()): AppTimer => ({
  ...timerState(row.data, now),
  id: row.id,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
});
export class TimeService {
  constructor(private readonly source: DataSource) {}
  async get(
    userId: string,
    id: string,
    db: EntityManager = this.source.manager,
  ) {
    const row = await db
      .getRepository(TimerEntity)
      .findOneBy({ id: parseId(id), userId, deleted: false });
    if (!row)
      throw new ApiError(404, "TIMER_NOT_FOUND", "倒计时不存在或无权访问");
    return row;
  }
  async list(userId: string) {
    const now = Date.now(),
      rows = await this.source.getRepository(TimerEntity).find({
        where: { userId, deleted: false },
        order: { createdAt: "DESC" },
        take: 100,
      });
    return {
      timers: rows.map((row) => view(row, now)),
      serverNow: new Date(now).toISOString(),
    };
  }
  create(userId: string, key: unknown, value: unknown) {
    const a = temporalDomain(() =>
      calendarObject(value, ["label", "durationSeconds"]),
    );
    if (
      typeof a.label !== "string" ||
      !a.label.trim() ||
      a.label.length > 100 ||
      !Number.isSafeInteger(a.durationSeconds) ||
      Number(a.durationSeconds) < 1 ||
      Number(a.durationSeconds) > 604800
    )
      throw new ApiError(
        400,
        "INVALID_TIMER",
        "名称最多 100 字，时长为 1 秒至 7 天的整数秒",
      );
    const input: TimerInput = {
      label: a.label.trim(),
      durationSeconds: Number(a.durationSeconds),
    };
    return mutateApplication(
      this.source,
      userId,
      "time",
      "create",
      key,
      input,
      async (db) => {
        const repo = db.getRepository(TimerEntity);
        if ((await repo.countBy({ userId, deleted: false })) >= 50)
          throw new ApiError(
            409,
            "TIMER_LIMIT",
            "最多保留 50 个倒计时，请整理已结束的记录",
          );
        const now = Date.now(),
          row: StoredTimer = {
            id: randomUUID(),
            userId,
            data: {
              ...input,
              status: "running",
              remainingMs: input.durationSeconds * 1000,
              deadline: new Date(
                now + input.durationSeconds * 1000,
              ).toISOString(),
            },
            revision: 1,
            deleted: false,
            createdAt: new Date(now),
          };
        await repo.insert(row);
        return view(row, now);
      },
    );
  }
  control(userId: string, id: string, key: unknown, value: unknown) {
    const a = temporalDomain(() =>
        calendarObject(value, ["revision", "action"]),
      ),
      version = revision(a.revision);
    if (!["pause", "resume", "restart", "cancel"].includes(String(a.action)))
      throw new ApiError(400, "INVALID_TIMER_ACTION", "倒计时操作无效");
    parseId(id);
    return mutateApplication(
      this.source,
      userId,
      "time",
      `control:${id}`,
      key,
      { revision: version, action: a.action },
      async (db) => {
        const row = await this.get(userId, id, db);
        if (row.revision !== version)
          throw new ApiError(
            409,
            "STALE_REVISION",
            "倒计时已更新，请刷新后重试",
          );
        const data = temporalDomain(() =>
          transitionTimer(row.data, a.action as TimerAction, Date.now()),
        );
        const result = await db
          .getRepository(TimerEntity)
          .update(
            { id, userId, revision: version, deleted: false },
            { data, revision: version + 1 },
          );
        if (!result.affected)
          throw new ApiError(
            409,
            "STALE_REVISION",
            "倒计时已更新，请刷新后重试",
          );
        return view({ ...row, data, revision: version + 1 });
      },
    );
  }
  remove(userId: string, id: string, key: unknown, value: unknown) {
    const a = temporalDomain(() => calendarObject(value, ["revision"])),
      version = revision(a.revision);
    parseId(id);
    return mutateApplication(
      this.source,
      userId,
      "time",
      `delete:${id}`,
      key,
      { revision: version },
      async (db) => {
        await this.get(userId, id, db);
        const result = await db
          .getRepository(TimerEntity)
          .update(
            { id, userId, revision: version, deleted: false },
            { deleted: true, revision: version + 1 },
          );
        if (!result.affected)
          throw new ApiError(
            409,
            "STALE_REVISION",
            "倒计时已更新，请刷新后重试",
          );
        return { deleted: true, id };
      },
    );
  }
}
