import type { DataSource } from "typeorm";
import type {
  ConfigurationDefinition,
  ConfigurationSnapshot,
  ConfigurationView,
  ConfigurationHistory,
  ConfigurationValue,
} from "@t-box/shared";
import { ApiError } from "@t-box/server-foundation/errors";
import { ConfigurationCache } from "./cache.js";
import { isDeepStrictEqual } from "node:util";
const decode = (value: unknown) =>
  typeof value === "string" ? JSON.parse(value) : value;
export function validateConfiguration(
  def: ConfigurationDefinition,
  value: unknown,
): ConfigurationValue {
  const valid =
    def.type === "number"
      ? typeof value === "number" &&
        Number.isFinite(value) &&
        (def.integer === false || Number.isSafeInteger(value)) &&
        value >= (def.min ?? 0) &&
        value <= (def.max ?? Number.MAX_SAFE_INTEGER)
      : def.type === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string" &&
          value.length <= (def.maxLength ?? 12000) &&
          (def.type !== "select" || def.options?.includes(value));
  if (!valid)
    throw new ApiError(
      400,
      "INVALID_CONFIGURATION",
      `${def.title}的值或范围不正确`,
    );
  if (def.type === "text" && typeof value === "string" && !value.trim())
    throw new ApiError(400, "INVALID_CONFIGURATION", `${def.title}不能为空`);
  return value as ConfigurationValue;
}
export class ConfigurationStore {
  private readonly definitions = new Map<string, ConfigurationDefinition>();
  constructor(
    readonly source: DataSource,
    readonly cache = new ConfigurationCache(),
  ) {}
  /** Platform AI configuration only; applications own their contracts and settings. */
  async register(definitions: ConfigurationDefinition[]) {
    for (const def of definitions) {
      if (
        !/^[a-zA-Z0-9_.-]{1,190}$/.test(def.key) ||
        def.key.startsWith("apps.")
      )
        throw new Error("Invalid configuration key");
      validateConfiguration(def, def.defaultValue);
      this.definitions.set(def.key, structuredClone(def));
    }
    await this.source.transaction(async (db) => {
      await db.query(
        "SELECT revision FROM platform_configuration_state WHERE id=1 FOR UPDATE",
      );
      let changed = false;
      for (const def of definitions) {
        const [existing] = await db.query(
          "SELECT definition_json FROM platform_configurations WHERE config_key=?",
          [def.key],
        );
        if (
          existing &&
          isDeepStrictEqual(decode(existing.definition_json), def)
        )
          continue;
        changed = true;
        await db.query(
          "INSERT IGNORE INTO platform_configurations(config_key,definition_json,value_json) VALUES(?,?,?)",
          [def.key, JSON.stringify(def), JSON.stringify(def.defaultValue)],
        );
        await db.query(
          "UPDATE platform_configurations SET definition_json=? WHERE config_key=?",
          [JSON.stringify(def), def.key],
        );
        await db.query(
          "INSERT IGNORE INTO platform_configuration_history(config_key,revision,value_json,note) VALUES(?,0,?,'平台默认配置')",
          [def.key, JSON.stringify(def.defaultValue)],
        );
      }
      // Metadata/default registration changes the catalog across processes as well.
      if (changed)
        await db.query(
          "UPDATE platform_configuration_state SET revision=revision+1 WHERE id=1",
        );
    });
  }
  async snapshot(): Promise<ConfigurationSnapshot> {
    const [state] = await this.source.query(
      "SELECT revision FROM platform_configuration_state WHERE id=1",
    );
    if (!state)
      throw new ApiError(503, "SCHEMA_REQUIRED", "请先初始化配置数据库");
    const revision = Number(state.revision);
    const raw = await this.cache.read<ConfigurationSnapshot>(
      "platform",
      revision,
      async () => {
        const rows = await this.source.query(
          "SELECT s.revision,c.config_key,CAST(c.value_json AS CHAR) AS value_json FROM platform_configuration_state s LEFT JOIN platform_configurations c ON c.config_key NOT LIKE 'apps.%' WHERE s.id=1",
        );
        return {
          revision: Number(rows[0].revision),
          values: Object.fromEntries(
            rows
              .filter((r: { config_key: string }) => r.config_key)
              .map((r: { config_key: string; value_json: unknown }) => [
                r.config_key,
                decode(r.value_json),
              ]),
          ),
        };
      },
    );
    // A concurrent publication during a cache miss must not be filed under the preceding revision.
    if (raw.revision !== revision) return this.snapshot();
    const ttl = raw.values["cache.ttlSeconds"];
    if (
      typeof ttl === "number" &&
      Number.isSafeInteger(ttl) &&
      ttl >= 30 &&
      ttl <= 3600
    )
      this.cache.ttlSeconds = ttl;
    return {
      revision,
      values: Object.fromEntries(
        [...this.definitions].map(([key, def]) => [
          key,
          validateConfiguration(def, raw.values[key] ?? def.defaultValue),
        ]),
      ),
    };
  }
  async view(): Promise<ConfigurationView> {
    const snapshot = await this.snapshot();
    return {
      revision: snapshot.revision,
      items: [...this.definitions.values()].map((def) => ({
        ...def,
        value: snapshot.values[def.key]!,
      })),
    };
  }
  async history(key: string): Promise<ConfigurationHistory[]> {
    this.definition(key);
    const rows = await this.source.query(
      "SELECT revision,CAST(value_json AS CHAR) AS value_json,administrator_id,note,created_at FROM platform_configuration_history WHERE config_key=? ORDER BY revision DESC LIMIT 50",
      [key],
    );
    return rows.map(
      (r: {
        revision: number;
        value_json: unknown;
        administrator_id: string | null;
        note: string;
        created_at: Date;
      }) => ({
        revision: Number(r.revision),
        value: decode(r.value_json),
        administratorId: r.administrator_id,
        note: r.note,
        createdAt: new Date(r.created_at).toISOString(),
      }),
    );
  }
  private definition(key: string) {
    const def = this.definitions.get(key);
    if (!def)
      throw new ApiError(
        404,
        "CONFIGURATION_NOT_FOUND",
        "配置项未注册或已移除",
      );
    return def;
  }
  async save(key: string, input: unknown, administratorId: string) {
    const def = this.definition(key);
    const body = input as {
      revision?: unknown;
      value?: unknown;
      note?: unknown;
      restoreRevision?: unknown;
    };
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) => !["revision", "value", "note", "restoreRevision"].includes(k),
      ) ||
      !Number.isSafeInteger(body.revision) ||
      (body.note !== undefined &&
        (typeof body.note !== "string" || body.note.length > 500))
    )
      throw new ApiError(400, "INVALID_CONFIGURATION", "配置格式不正确");
    let value = body.value;
    if (body.restoreRevision !== undefined) {
      if (
        !Number.isSafeInteger(body.restoreRevision) ||
        Number(body.restoreRevision) < 0 ||
        body.value !== undefined
      )
        throw new ApiError(400, "INVALID_CONFIGURATION", "恢复版本无效");
      const [old] = await this.source.query(
        "SELECT CAST(value_json AS CHAR) AS value_json FROM platform_configuration_history WHERE config_key=? AND revision=?",
        [key, body.restoreRevision],
      );
      if (!old)
        throw new ApiError(
          404,
          "CONFIGURATION_VERSION_NOT_FOUND",
          "配置版本不存在",
        );
      value = decode(old.value_json);
    }
    value = validateConfiguration(def, value);
    await this.source.transaction(async (db) => {
      const [state] = await db.query(
        "SELECT revision FROM platform_configuration_state WHERE id=1 FOR UPDATE",
      );
      if (Number(state?.revision) !== body.revision)
        throw new ApiError(
          409,
          "CONFIGURATION_CHANGED",
          "配置已更新，请刷新后再保存",
        );
      await db.query(
        "UPDATE platform_configurations SET value_json=?,updated_at=UTC_TIMESTAMP(3) WHERE config_key=?",
        [JSON.stringify(value), key],
      );
      await db.query(
        "INSERT INTO platform_configuration_history(config_key,revision,value_json,administrator_id,note) VALUES(?,?,?,?,?)",
        [
          key,
          Number(state.revision) + 1,
          JSON.stringify(value),
          administratorId,
          body.restoreRevision !== undefined
            ? `恢复版本 ${body.restoreRevision}：${body.note ?? ""}`.slice(
                0,
                500,
              )
            : (body.note ?? ""),
        ],
      );
      await db.query(
        "UPDATE platform_configuration_state SET revision=revision+1 WHERE id=1",
      );
    });
    return this.view();
  }
}
