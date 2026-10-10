import { createHash } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { ApiError } from "../errors.js";
import { ApplicationOperationEntity } from "./entities.js";
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");
export async function mutateApplication<T>(
  source: DataSource,
  userId: string,
  appId: string,
  action: string,
  key: unknown,
  payload: unknown,
  run: (db: EntityManager) => Promise<T>,
): Promise<T> {
  if (typeof key !== "string" || key.length < 8 || key.length > 200)
    throw new ApiError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "请提供 8 至 200 字符的操作标识",
    );
  const operationKey = fingerprint([action, key]),
    payloadHash = fingerprint(payload);
  return source.transaction(async (db) => {
    const users = await db.query(
      "SELECT id FROM app_users WHERE id=? AND enabled=1 FOR UPDATE",
      [userId],
    );
    if (!users.length) throw new ApiError(401, "UNAUTHORIZED", "账号不可用");
    const repo = db.getRepository(ApplicationOperationEntity),
      old = await repo.findOneBy({ userId, appId, operationKey });
    if (old) {
      if (old.payloadHash !== payloadHash)
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "同一操作标识不能用于不同内容",
        );
      return old.response as T;
    }
    const response = await run(db);
    await repo.save({
      userId,
      appId,
      operationKey,
      payloadHash,
      response,
      createdAt: new Date(),
    });
    return response;
  });
}
