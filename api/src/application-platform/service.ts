import { createHash, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import {
  validateRelease,
  APP_SDK_VERSION,
  type AppRelease,
  type AppInstallation,
  type LifecycleAction,
  type LifecycleReceipt,
  type MarketEntry,
  type RuntimeDescriptor,
  type ApplicationContext,
} from "@t-box/app-contracts";
import { ApiError } from "@t-box/server-foundation/errors";
import type { ApplicationBackend } from "./adapters/contracts.js";
const json = <T>(value: string | T): T =>
  typeof value === "string" ? JSON.parse(value) : value;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
interface Operation {
  id: string;
  user_id: string;
  app_id: string;
  release_id: string;
  generation: number;
  action: LifecycleAction;
  submitted: number;
  attempts: number;
  status: string;
  receipt: unknown;
  error: string | null;
  lease_token: string | null;
}
export class ApplicationPlatform {
  private readonly backends = new Map<string, ApplicationBackend>();
  private initialized?: Promise<void>;
  private readonly bootstraps = new Map<string, Promise<void>>();
  private catalogStamp = "";
  constructor(
    private readonly source: DataSource,
    private readonly releases: readonly AppRelease[],
    private readonly kinds: Readonly<Record<string, AppRelease["kind"]>> = {},
  ) {}
  bind(name: string, backend: ApplicationBackend) {
    if (this.backends.has(name)) throw new Error("Duplicate backend binding");
    this.backends.set(name, backend);
  }
  initialize() {
    return (this.initialized ??= this.seed().catch((e) => {
      this.initialized = undefined;
      throw e;
    }));
  }
  private async seed() {
    for (const release of this.releases) {
      validateRelease(release);
      if (
        release.backend.type !== "none" &&
        !this.backends.has(release.backend.binding)
      )
        throw new Error("Application backend not deployed");
      await this.source.transaction(async (db) => {
        // Take an exclusive registry-row lock immediately. INSERT IGNORE on an
        // existing key takes shared locks, whose later FOR UPDATE upgrades can
        // deadlock when multiple API workers seed the same applications.
        await db.query(
          "INSERT INTO application_registry(app_id,kind,created_at) VALUES(?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE app_id=app_id",
          [release.appId, this.kinds[release.appId] ?? release.kind],
        );
        const [policy] = await db.query(
          "SELECT kind FROM application_registry WHERE app_id=? FOR UPDATE",
          [release.appId],
        );
        const [old] = await db.query(
          "SELECT definition,definition_hash FROM application_releases WHERE release_id=? FOR UPDATE",
          [release.releaseId],
        );
        if (old && old.definition_hash !== hash(release)) {
          // Kind moved to the app-level registry in the publishing migration. Preserve the historical definition and hash.
          const historical = json<AppRelease>(old.definition);
          if (
            policy.kind !== release.kind ||
            hash({ ...release, kind: historical.kind }) !== old.definition_hash
          )
            throw new Error(`Immutable release changed: ${release.releaseId}`);
        }
        const [known] = await db.query(
          "SELECT release_id FROM application_releases WHERE app_id=? LIMIT 1",
          [release.appId],
        );
        // Only trusted code/deployment can register executable bindings. User installation never registers services.
        await db.query(
          "INSERT IGNORE INTO application_releases(release_id,app_id,definition,definition_hash,published,status,created_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))",
          [
            release.releaseId,
            release.appId,
            JSON.stringify(release),
            hash(release),
            known ? 0 : 1,
            known ? "submitted" : "published",
          ],
        );
        if (!old && !known)
          await db.query(
            "UPDATE application_releases SET published=(release_id=?),status=IF(release_id=?,'published',IF(status='published','retired',status)) WHERE app_id=?",
            [release.releaseId, release.releaseId, release.appId],
          );
      });
    }
  }
  async release(
    id: string,
    db: EntityManager | DataSource = this.source,
  ): Promise<AppRelease> {
    const [row] = await db.query(
      "SELECT r.definition,a.kind FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id WHERE r.release_id=?",
      [id],
    );
    if (!row)
      throw new ApiError(404, "APP_RELEASE_NOT_FOUND", "应用版本不存在");
    return { ...json<AppRelease>(row.definition), kind: row.kind };
  }
  invalidateCatalog() {
    this.bootstraps.clear();
  }
  hasBackend(binding: string) {
    return this.backends.has(binding);
  }
  deployedRelease(appId: string) {
    return this.releases.find((r) => r.appId === appId);
  }
  private installation(row: Record<string, unknown>): AppInstallation {
    return {
      appId: String(row.app_id),
      releaseId: String(row.release_id),
      ...(row.installed_version
        ? { version: String(row.installed_version) }
        : {}),
      targetReleaseId: row.target_release_id
        ? String(row.target_release_id)
        : null,
      generation: Number(row.generation),
      status: row.status as AppInstallation["status"],
      operationId: row.operation_id ? String(row.operation_id) : null,
      grants: json<string[]>(row.grants as string),
    };
  }
  async bootstrap(userId: string) {
    await this.initialize();
    // Database publication is shared across API workers; a local invalidation alone is insufficient.
    const stamp = hash(
      await this.source.query(
        "SELECT app_id,release_id FROM application_releases WHERE published=1 ORDER BY app_id",
      ),
    );
    if (stamp !== this.catalogStamp) {
      this.catalogStamp = stamp;
      this.bootstraps.clear();
    }
    const existing = this.bootstraps.get(userId);
    if (existing) return existing;
    if (this.bootstraps.size >= 5000)
      this.bootstraps.delete(this.bootstraps.keys().next().value!);
    const promise = this.ensureDefaults(userId).catch((error) => {
      this.bootstraps.delete(userId);
      throw error;
    });
    this.bootstraps.set(userId, promise);
    return promise;
  }
  private async ensureDefaults(userId: string) {
    // INSERT IGNORE preserves revoked tombstones: visiting OS cannot reinstall a removed app.
    const defaults = await this.source.query(
      "SELECT r.definition,a.kind FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id WHERE r.published=1 AND (a.kind='system' OR JSON_EXTRACT(r.definition,'$.defaultInstalled')=true)",
    );
    for (const published of defaults) {
      const r = json<AppRelease>(published.definition);
      if (published.kind === "system")
        await this.source.query(
          "UPDATE application_installations SET status='installing',generation=generation+1 WHERE user_id=? AND app_id=? AND status='revoked' AND operation_id IS NULL",
          [userId, r.appId],
        );
      await this.source.query(
        `INSERT IGNORE INTO application_installations(user_id,app_id,release_id,status,grants) VALUES(?,?,?,'installing',?)`,
        [userId, r.appId, r.releaseId, JSON.stringify(r.permissions)],
      );
      const [row] = await this.source.query(
        "SELECT * FROM application_installations WHERE user_id=? AND app_id=?",
        [userId, r.appId],
      );
      if (row?.status === "installing" && !row.operation_id)
        await this.change(
          userId,
          r.appId,
          "install",
          r.releaseId,
          `bootstrap-${hash(r.releaseId).slice(0, 32)}-${row.generation}`,
          r.permissions,
        );
    }
  }
  async catalog(userId: string): Promise<MarketEntry[]> {
    await this.bootstrap(userId);
    const rows = await this.source.query(
      `SELECT r.definition,a.kind,i.*,JSON_UNQUOTE(JSON_EXTRACT(installed.definition,'$.manifest.version')) AS installed_version FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id LEFT JOIN application_installations i ON i.app_id=r.app_id AND i.user_id=? LEFT JOIN application_releases installed ON installed.release_id=i.release_id WHERE r.published=1 ORDER BY r.created_at,r.app_id`,
      [userId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      release: {
        ...json<AppRelease>(r.definition as string),
        kind: r.kind as AppRelease["kind"],
      },
      installation: r.user_id ? this.installation(r) : null,
    }));
  }
  async installed(userId: string) {
    const entries = (await this.catalog(userId)).filter(
      (e) => e.installation?.status === "active",
    );
    return Promise.all(
      entries.map(async (e) => ({
        ...e,
        release:
          e.installation!.releaseId === e.release.releaseId
            ? e.release
            : await this.release(e.installation!.releaseId),
      })),
    );
  }
  async assertActive(
    userId: string,
    appId: string,
    expected?: { releaseId: string; generation: number },
  ) {
    await this.bootstrap(userId);
    const [row] = await this.source.query(
      "SELECT * FROM application_installations WHERE user_id=? AND app_id=?",
      [userId, appId],
    );
    if (!row || row.status !== "active")
      throw new ApiError(403, "APP_NOT_INSTALLED", "请先在应用市场安装此应用");
    const installation = this.installation(row);
    if (
      expected &&
      (expected.releaseId !== installation.releaseId ||
        expected.generation !== installation.generation)
    )
      throw new ApiError(
        409,
        "APP_RUNTIME_EXPIRED",
        "应用版本或安装状态已改变，请重新打开",
      );
    const release = await this.release(installation.releaseId);
    if (
      release.permissions.some(
        (permission) => !installation.grants.includes(permission),
      )
    )
      throw new ApiError(
        403,
        "APP_PERMISSION_REVOKED",
        "应用权限已撤销，请重新确认安装权限",
      );
    return { installation, release };
  }
  async change(
    userId: string,
    appId: string,
    action: LifecycleAction,
    releaseId: string,
    key: string,
    grants: string[],
  ) {
    await this.initialize();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key))
      throw new ApiError(400, "INVALID_REQUEST_KEY", "操作标识无效");
    const requestHash = hash({ action, releaseId, grants: [...grants].sort() });
    const op = await this.source.transaction(async (db) => {
      await db.query("SELECT id FROM app_users WHERE id=? FOR UPDATE", [
        userId,
      ]);
      const [existing] = await db.query(
        "SELECT * FROM application_lifecycle_operations WHERE user_id=? AND app_id=? AND request_key=?",
        [userId, appId, key],
      );
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new ApiError(
            409,
            "APP_REQUEST_CONFLICT",
            "操作标识已被其他请求使用",
          );
        return existing as Operation;
      }
      const [row] = await db.query(
        "SELECT * FROM application_installations WHERE user_id=? AND app_id=? FOR UPDATE",
        [userId, appId],
      );
      if (row?.operation_id)
        throw new ApiError(
          409,
          "APP_OPERATION_PENDING",
          "此应用有操作正在处理",
        );
      const target = await this.release(
        action === "uninstall" && row ? row.release_id : releaseId,
        db,
      );
      if (target.appId !== appId)
        throw new ApiError(400, "APP_RELEASE_MISMATCH", "应用版本不匹配");
      if (action === "uninstall" && target.kind === "system")
        throw new ApiError(403, "SYSTEM_APP_REQUIRED", "系统应用不能卸载");
      if (action === "uninstall" && (!row || row.status === "revoked"))
        throw new ApiError(409, "APP_ALREADY_REMOVED", "应用已经卸载");
      if (action === "update" && row?.status !== "active")
        throw new ApiError(409, "APP_NOT_INSTALLED", "请先安装应用");
      if (action === "install" && row?.status === "active")
        throw new ApiError(409, "APP_ALREADY_INSTALLED", "应用已经安装");
      if (action !== "uninstall") {
        const [pub] = await db.query(
          "SELECT published FROM application_releases WHERE release_id=?",
          [target.releaseId],
        );
        if (!pub?.published)
          throw new ApiError(409, "APP_RELEASE_UNPUBLISHED", "应用版本已下架");
        if (
          target.permissions.some((p) => !grants.includes(p)) ||
          grants.some((p) => !target.permissions.includes(p))
        )
          throw new ApiError(
            400,
            "APP_PERMISSION_REQUIRED",
            "请确认此版本的应用权限",
          );
      }
      const id = randomUUID(),
        generation =
          Number(row?.generation || 0) +
            (action === "install" && row?.status !== "installing" ? 1 : 0) || 1;
      await db.query(
        `INSERT INTO application_lifecycle_operations(id,user_id,app_id,request_key,request_hash,release_id,generation,action,created_at,updated_at,next_attempt_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [
          id,
          userId,
          appId,
          key,
          requestHash,
          target.releaseId,
          generation,
          action,
        ],
      );
      const status =
        action === "uninstall"
          ? "revoked"
          : action === "update"
            ? "active"
            : "installing";
      await db.query(
        `INSERT INTO application_installations(user_id,app_id,release_id,target_release_id,generation,status,grants,operation_id) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE target_release_id=VALUES(target_release_id),generation=VALUES(generation),status=VALUES(status),grants=IF(VALUES(status)='revoked',JSON_ARRAY(),grants),operation_id=VALUES(operation_id),updated_at=UTC_TIMESTAMP(3)`,
        [
          userId,
          appId,
          target.releaseId,
          action === "uninstall" ? null : target.releaseId,
          generation,
          status,
          JSON.stringify(grants),
          id,
        ],
      );
      const [created] = await db.query(
        "SELECT * FROM application_lifecycle_operations WHERE id=?",
        [id],
      );
      return created as Operation;
    });
    await this.process(op.id);
    return this.operation(userId, op.id);
  }
  async operation(userId: string, id: string) {
    const [op] = await this.source.query(
      "SELECT id,app_id,action,status,receipt,error FROM application_lifecycle_operations WHERE id=? AND user_id=?",
      [id, userId],
    );
    if (!op)
      throw new ApiError(404, "APP_OPERATION_NOT_FOUND", "应用操作不存在");
    return {
      id: op.id,
      appId: op.app_id,
      action: op.action,
      status: op.status,
      error: op.error,
      receipt: op.receipt ? json(op.receipt) : null,
    };
  }
  async recover() {
    await this.initialize();
    const rows = await this.source.query(
      `SELECT id,release_id FROM application_lifecycle_operations WHERE status IN ('queued','pending') AND next_attempt_at<=UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) ORDER BY created_at LIMIT 20`,
    );
    for (const row of rows) {
      const release = await this.release(row.release_id);
      if (
        release.backend.type !== "none" &&
        !this.backends.has(release.backend.binding)
      )
        continue;
      await this.process(row.id);
    }
  }
  private async process(id: string) {
    const token = randomUUID();
    const claim = await this.source.query(
      `UPDATE application_lifecycle_operations SET lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),attempts=attempts+1 WHERE id=? AND status IN ('queued','pending') AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))`,
      [token, id],
    );
    if (!claim.affectedRows) return;
    const [op]: Operation[] = await this.source.query(
      "SELECT * FROM application_lifecycle_operations WHERE id=?",
      [id],
    );
    if (!op) return;
    try {
      const release = await this.release(op.release_id),
        backend = this.backends.get(release.backend.binding);
      if (release.backend.type !== "none" && !backend) {
        await this.retry(id, token);
        return;
      }
      const request = {
        operationId: op.id,
        appId: op.app_id,
        releaseId: op.release_id,
        subject: this.subject(op.user_id, op.app_id),
        generation: Number(op.generation),
        action: op.action,
      };
      let result: LifecycleReceipt | null =
        release.backend.type === "none"
          ? { status: "completed", receipt: {} }
          : op.submitted
            ? await backend!.operation(request)
            : null;
      if (!result) {
        await this.source.query(
          "UPDATE application_lifecycle_operations SET submitted=1 WHERE id=? AND lease_token=?",
          [id, token],
        );
        result = backend
          ? await backend.lifecycle(request)
          : { status: "completed", receipt: {} };
      }
      if (!result || result.status === "pending") {
        await this.retry(id, token);
        return;
      }
      await this.source.transaction(async (db) => {
        // Generation + operation fence prevents a stale worker from activating a reinstalled application.
        const [locked] = await db.query(
          "SELECT lease_token FROM application_lifecycle_operations WHERE id=? FOR UPDATE",
          [id],
        );
        if (locked?.lease_token !== token) return;
        const [current] = await db.query(
          "SELECT * FROM application_installations WHERE user_id=? AND app_id=? FOR UPDATE",
          [op.user_id, op.app_id],
        );
        if (
          current?.operation_id !== id ||
          Number(current.generation) !== Number(op.generation)
        )
          return;
        const ok = result!.status === "completed";
        if (ok && op.action !== "uninstall")
          await db.query(
            `UPDATE application_installations SET release_id=?,status='active',grants=?,target_release_id=NULL,operation_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND app_id=?`,
            [
              release.releaseId,
              JSON.stringify(release.permissions),
              op.user_id,
              op.app_id,
            ],
          );
        else
          await db.query(
            `UPDATE application_installations SET status=?,target_release_id=NULL,operation_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND app_id=?`,
            [
              op.action === "uninstall"
                ? "revoked"
                : op.action === "update"
                  ? "active"
                  : "failed",
              op.user_id,
              op.app_id,
            ],
          );
        await db.query(
          `UPDATE application_lifecycle_operations SET status=?,receipt=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=?`,
          [
            ok ? "completed" : "failed",
            ok
              ? JSON.stringify((result as { receipt: unknown }).receipt)
              : null,
            result!.status === "rejected" ? result!.message : null,
            id,
            token,
          ],
        );
      });
    } catch {
      await this.retry(id, token);
    }
  }
  private async retry(id: string, token: string) {
    await this.source.query(
      `UPDATE application_lifecycle_operations SET status='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 SECOND),error='应用服务尚未确认结果，正在核对',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=?`,
      [id, token],
    );
  }
  subject(userId: string, appId: string) {
    return createHash("sha256").update(`${appId}:${userId}`).digest("hex");
  }
  async runtime(
    userId: string,
    appId: string,
    platform: "web" | "android" | "ios",
  ): Promise<RuntimeDescriptor> {
    const { installation, release } = await this.assertActive(userId, appId);
    if (!release.platforms.includes(platform) || release.runtime.type !== "web")
      throw new ApiError(
        409,
        "APP_RUNTIME_UNSUPPORTED",
        "应用不支持此运行环境",
      );
    return {
      protocol: 1,
      appId,
      releaseId: release.releaseId,
      generation: installation.generation,
      entryUrl: release.runtime.entryUrl,
      origin: new URL(release.runtime.entryUrl).origin,
      subject: this.subject(userId, appId),
      clientTools: release.clientTools,
      permissions: installation.grants,
    };
  }
  /** Runtime binding for both trusted shell modules and isolated web containers. */
  async context(
    userId: string,
    appId: string,
    platform: "web" | "android" | "ios",
  ): Promise<ApplicationContext> {
    const { installation, release } = await this.assertActive(userId, appId);
    if (!release.platforms.includes(platform))
      throw new ApiError(
        409,
        "APP_RUNTIME_UNSUPPORTED",
        "应用不支持此运行环境",
      );
    return {
      sdkVersion: APP_SDK_VERSION,
      appId,
      releaseId: release.releaseId,
      generation: installation.generation,
      subject: this.subject(userId, appId),
      platform,
      runtime: release.runtime.type,
      params: {},
      permissions: installation.grants,
      capabilities: [
        "runtime.context",
        "auth.session",
        "navigation.back",
        "navigation.open",
        ...(release.backend.type !== "none" ? ["api.invoke" as const] : []),
        ...(installation.grants.includes("storage")
          ? [
              "storage.get" as const,
              "storage.set" as const,
              "storage.remove" as const,
            ]
          : []),
      ],
    };
  }
  async invoke(
    userId: string,
    appId: string,
    releaseId: string,
    generation: number,
    method: string,
    args: unknown,
    invocationId: string,
    signal?: AbortSignal,
  ) {
    const { installation, release } = await this.assertActive(userId, appId, {
      releaseId,
      generation,
    });
    if (!installation.grants.includes(`${appId}.${method}`))
      throw new ApiError(403, "APP_PERMISSION_DENIED", "此应用没有该操作权限");
    const backend = this.backends.get(release.backend.binding);
    if (!backend)
      throw new ApiError(503, "APP_BACKEND_UNAVAILABLE", "应用后端不可用");
    return backend.invoke(
      {
        invocationId,
        appId,
        releaseId,
        subject: this.subject(userId, appId),
        generation,
        method,
        arguments: args,
      },
      signal,
    );
  }
}
