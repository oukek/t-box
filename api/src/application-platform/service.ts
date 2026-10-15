import type { AppInstallation, ApplicationContext, AppRelease, LifecycleAction, LifecycleReceipt, MarketEntry, RuntimeDescriptor } from '@t-box/app-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { ApplicationBackend } from './adapters/contracts.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  APP_SDK_VERSION,
  validateRelease,
} from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { ApplicationArtifacts } from './artifacts.js'

const json = <T>(value: string | T): T =>
  typeof value === 'string' ? JSON.parse(value) : value
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex')
interface Operation {
  id: string
  user_id: string
  app_id: string
  release_id: string
  generation: number
  action: LifecycleAction
  submitted: number
  attempts: number
  status: string
  receipt: unknown
  error: string | null
  lease_token: string | null
}
export class ApplicationPlatform {
  private readonly backends = new Map<string, ApplicationBackend>()
  private initialized?: Promise<void>
  private readonly bootstraps = new Map<string, Promise<void>>()
  private readonly bootstrapTimes = new Map<string, number>()
  private readonly faults = new Map<string, string>()
  private catalogStamp = ''
  constructor(
    private readonly source: DataSource,
    private readonly releases: readonly AppRelease[],
    private readonly kinds: Readonly<Record<string, AppRelease['kind']>> = {},
    private readonly options: { shellMigrations?: readonly string[], deploymentIssues?: Record<string, string> } = {},
  ) {}

  bind(name: string, backend: ApplicationBackend) {
    if (this.backends.has(name)) {
      throw new Error('Duplicate backend binding')
    }
    this.backends.set(name, backend)
  }

  initialize() {
    return (this.initialized ??= this.seed().catch((e) => {
      this.initialized = undefined
      throw e
    }))
  }

  private async seed() {
    for (const release of this.releases) {
      if (this.options.deploymentIssues?.[release.appId]) {
        continue
      }
      try {
        validateRelease(release)
        if (
          release.backend.type !== 'none' &&
          !this.backends.has(release.backend.binding)
        ) {
          this.faults.set(release.appId, '应用后端尚未部署')
          continue
        }
        await this.source.transaction(async (db) => {
        // Take an exclusive registry-row lock immediately. INSERT IGNORE on an
        // existing key takes shared locks, whose later FOR UPDATE upgrades can
        // deadlock when multiple API workers seed the same applications.
          await db.query(
            'INSERT INTO application_registry(app_id,kind,created_at) VALUES(?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE app_id=app_id',
            [release.appId, this.kinds[release.appId] ?? release.kind],
          )
          const [policy] = await db.query(
            'SELECT kind FROM application_registry WHERE app_id=? FOR UPDATE',
            [release.appId],
          )
          const [old] = await db.query(
            'SELECT definition,definition_hash FROM application_releases WHERE release_id=? FOR UPDATE',
            [release.releaseId],
          )
          if (old && old.definition_hash !== hash(release)) {
          // Kind moved to the app-level registry in the publishing migration. Preserve the historical definition and hash.
            const historical = json<AppRelease>(old.definition)
            if (
              policy.kind !== release.kind ||
              hash({ ...release, kind: historical.kind }) !== old.definition_hash
            ) {
              throw new Error(`Immutable release changed: ${release.releaseId}`)
            }
          }
          const [known] = await db.query(
            'SELECT release_id FROM application_releases WHERE app_id=? LIMIT 1',
            [release.appId],
          )
          // Only trusted code/deployment can register executable bindings. User installation never registers services.
          await db.query(
            'INSERT IGNORE INTO application_releases(release_id,app_id,definition,definition_hash,published,status,created_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))',
            [
              release.releaseId,
              release.appId,
              JSON.stringify(release),
              hash(release),
              known ? 0 : 1,
              known ? 'submitted' : 'published',
            ],
          )
          if (!old && !known) {
            await db.query(
              'UPDATE application_releases SET published=(release_id=?),status=IF(release_id=?,\'published\',IF(status=\'published\',\'retired\',status)) WHERE app_id=?',
              [release.releaseId, release.releaseId, release.appId],
            )
          }
          if (this.options.shellMigrations?.includes(release.appId) && release.runtime.type === 'web') {
            const [legacy] = await db.query('SELECT release_id,definition FROM application_releases WHERE app_id=? AND published=1', [release.appId])
            if (legacy && json<AppRelease>(legacy.definition).runtime.type === 'shell') {
              await db.query('UPDATE application_releases SET published=0,status=\'retired\',revision=revision+1 WHERE release_id=?', [legacy.release_id])
              await db.query('UPDATE application_releases SET published=1,status=\'published\',published_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE release_id=?', [release.releaseId])
              await db.query('INSERT INTO application_publication_events(id,app_id,release_id,action,administrator_id,detail) VALUES(?,?,?,?,?,?)', [randomUUID(), release.appId, release.releaseId, 'migrate_runtime', '00000000-0000-0000-0000-000000000000', JSON.stringify({ from: legacy.release_id, origin: 'trusted_deployment' })])
            }
          }
        })
      } catch (error) {
        if (error && typeof error === 'object' && ('driverError' in error || (error as { name?: string }).name === 'QueryFailedError')) {
          throw error
        }
        this.faults.set(release.appId, '应用版本定义不兼容，请管理员检查部署配置')
      }
    }
  }

  async release(
    id: string,
    db: EntityManager | DataSource = this.source,
  ): Promise<AppRelease> {
    const [row] = await db.query(
      'SELECT r.definition,a.kind FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id WHERE r.release_id=?',
      [id],
    )
    if (!row) {
      throw new ApiError(404, 'APP_RELEASE_NOT_FOUND', '应用版本不存在')
    }
    return { ...json<AppRelease>(row.definition), kind: row.kind }
  }

  invalidateCatalog() {
    this.bootstraps.clear()
    this.bootstrapTimes.clear()
  }

  hasBackend(binding: string) {
    return this.backends.has(binding)
  }

  deployedRelease(appId: string) {
    return this.releases.find((r) => r.appId === appId)
  }

  applicationKind(appId: string) {
    return this.kinds[appId] || this.deployedRelease(appId)?.kind || null
  }

  deploymentIssue(appId: string) {
    return this.faults.get(appId) || this.options.deploymentIssues?.[appId] || null
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
      status: row.status as AppInstallation['status'],
      operationId: row.operation_id ? String(row.operation_id) : null,
      grants: json<string[]>(row.grants as string),
      error: row.error ? String(row.error) : null,
    }
  }

  async bootstrap(userId: string) {
    await this.initialize()
    // Database publication is shared across API workers; a local invalidation alone is insufficient.
    const stamp = hash(
      await this.source.query(
        'SELECT app_id,release_id FROM application_releases WHERE published=1 ORDER BY app_id',
      ),
    )
    if (stamp !== this.catalogStamp) {
      this.catalogStamp = stamp
      this.bootstraps.clear()
      this.bootstrapTimes.clear()
    }
    const existing = this.bootstraps.get(userId)
    if (existing && Date.now() - (this.bootstrapTimes.get(userId) || 0) < 10_000) {
      return existing
    }
    if (this.bootstraps.size >= 5000) {
      const oldest = this.bootstraps.keys().next().value!
      this.bootstraps.delete(oldest)
      this.bootstrapTimes.delete(oldest)
    }
    const promise = this.ensureDefaults(userId).catch((error) => {
      this.bootstraps.delete(userId)
      throw error
    })
    this.bootstraps.set(userId, promise)
    this.bootstrapTimes.set(userId, Date.now())
    return promise
  }

  private async ensureDefaults(userId: string) {
    // INSERT IGNORE preserves revoked tombstones: visiting OS cannot reinstall a removed app.
    const defaults = await this.source.query(
      'SELECT r.definition,a.kind FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id WHERE r.published=1 AND (a.kind=\'system\' OR JSON_EXTRACT(r.definition,\'$.defaultInstalled\')=true)',
    )
    for (const published of defaults) {
      const r = json<AppRelease>(published.definition)
      try {
        if (published.kind === 'system') {
          await this.source.query(
            'UPDATE application_installations SET status=\'installing\',generation=generation+1 WHERE user_id=? AND app_id=? AND status=\'revoked\' AND operation_id IS NULL',
            [userId, r.appId],
          )
        }
        await this.source.query(
          `INSERT IGNORE INTO application_installations(user_id,app_id,release_id,status,grants) VALUES(?,?,?,'installing',?)`,
          [userId, r.appId, r.releaseId, JSON.stringify(r.permissions)],
        )
        const [row] = await this.source.query(
          'SELECT *,(retry_at IS NULL OR retry_at<=UTC_TIMESTAMP(3)) AS retry_ready FROM application_installations WHERE user_id=? AND app_id=?',
          [userId, r.appId],
        )
        if (row?.status === 'active' && !row.operation_id && r.runtime.type === 'web' && this.options.shellMigrations?.includes(r.appId)) {
          const installed = await this.release(row.release_id)
          if (installed.runtime.type === 'shell') {
            await this.source.transaction(async (db) => {
              await db.query('SELECT id FROM app_users WHERE id=? FOR UPDATE', [userId])
              await db.query('UPDATE application_installations SET release_id=?,generation=generation+1,grants=?,error=NULL WHERE user_id=? AND app_id=? AND release_id=? AND status=\'active\' AND operation_id IS NULL', [r.releaseId, JSON.stringify(r.permissions), userId, r.appId, row.release_id])
            })
          }
        }
        if (published.kind === 'system' && row?.status === 'failed' && Number(row.retry_attempts) < 5 && Number(row.retry_ready)) {
          await this.source.query('UPDATE application_installations SET status=\'installing\',generation=generation+1 WHERE user_id=? AND app_id=? AND status=\'failed\' AND operation_id IS NULL', [userId, r.appId])
          row.status = 'installing'
          row.generation = Number(row.generation) + 1
        }
        if (row?.status === 'installing' && !row.operation_id) {
          await this.change(
            userId,
            r.appId,
            'install',
            r.releaseId,
            `bootstrap-${hash(r.releaseId).slice(0, 32)}-${row.generation}`,
            r.permissions,
            { background: r.backend.type === 'remote' },
          )
        }
      } catch (error) {
        // Per-application contract errors must not take down unrelated installed applications.
        if (!(error instanceof ApiError)) {
          throw error
        }
        await this.source.query('UPDATE application_installations SET error=? WHERE user_id=? AND app_id=?', [error.message.slice(0, 300), userId, r.appId])
      }
    }
  }

  async catalog(userId: string): Promise<MarketEntry[]> {
    await this.bootstrap(userId)
    const rows = await this.source.query(
      `SELECT r.definition,a.kind,i.*,JSON_UNQUOTE(JSON_EXTRACT(installed.definition,'$.manifest.version')) AS installed_version FROM application_releases r JOIN application_registry a ON a.app_id=r.app_id LEFT JOIN application_installations i ON i.app_id=r.app_id AND i.user_id=? LEFT JOIN application_releases installed ON installed.release_id=i.release_id WHERE r.published=1 ORDER BY r.created_at,r.app_id`,
      [userId],
    )
    return rows.map((r: Record<string, unknown>) => ({
      release: {
        ...json<AppRelease>(r.definition as string),
        kind: r.kind as AppRelease['kind'],
      },
      installation: r.user_id ? this.installation(r) : null,
      issue: r.status === 'active' ? null : this.deploymentIssue(String(r.app_id)),
    }))
  }

  async installed(userId: string) {
    const entries = (await this.catalog(userId)).filter(
      (e) => e.installation?.status === 'active',
    )
    return Promise.all(
      entries.map(async (e) => ({
        ...e,
        release:
          e.installation!.releaseId === e.release.releaseId
            ? e.release
            : await this.release(e.installation!.releaseId),
      })),
    )
  }

  async repair(userId: string, appId: string) {
    await this.initialize()
    const [releaseRow] = await this.source.query('SELECT definition FROM application_releases WHERE app_id=? AND published=1', [appId])
    if (!releaseRow) {
      throw new ApiError(503, 'APP_DEPLOYMENT_UNAVAILABLE', this.deploymentIssue(appId) || '应用版本尚未部署')
    }
    const release = json<AppRelease>(releaseRow.definition)
    const [row] = await this.source.query('SELECT * FROM application_installations WHERE user_id=? AND app_id=?', [userId, appId])
    if (row?.status === 'active' && !row.operation_id) {
      return { status: 'completed' }
    }
    if (row?.operation_id) {
      await this.process(row.operation_id)
      return this.operation(userId, row.operation_id)
    }
    if ((!row || row.status === 'revoked') && release.kind !== 'system') {
      throw new ApiError(403, 'APP_NOT_INSTALLED', '请先在市场安装此应用')
    }
    const result = await this.change(userId, appId, 'install', release.releaseId, randomUUID(), release.permissions, { background: release.backend.type === 'remote' })
    this.bootstraps.delete(userId)
    return result
  }

  async assertActive(
    userId: string,
    appId: string,
    expected?: { releaseId: string, generation: number },
  ) {
    await this.bootstrap(userId)
    const [row] = await this.source.query(
      'SELECT * FROM application_installations WHERE user_id=? AND app_id=?',
      [userId, appId],
    )
    if (!row || row.status !== 'active') {
      throw new ApiError(403, 'APP_NOT_INSTALLED', '请先在应用市场安装此应用')
    }
    const installation = this.installation(row)
    if (
      expected &&
      (expected.releaseId !== installation.releaseId ||
        expected.generation !== installation.generation)
    ) {
      throw new ApiError(
        409,
        'APP_RUNTIME_EXPIRED',
        '应用版本或安装状态已改变，请重新打开',
      )
    }
    const release = await this.release(installation.releaseId)
    if (
      release.permissions.some(
        (permission) => !installation.grants.includes(permission),
      )
    ) {
      throw new ApiError(
        403,
        'APP_PERMISSION_REVOKED',
        '应用权限已撤销，请重新确认安装权限',
      )
    }
    return { installation, release }
  }

  async change(
    userId: string,
    appId: string,
    action: LifecycleAction,
    releaseId: string,
    key: string,
    grants: string[],
    options: { background?: boolean } = {},
  ) {
    await this.initialize()
    if (!/^[\w-]{1,80}$/.test(key)) {
      throw new ApiError(400, 'INVALID_REQUEST_KEY', '操作标识无效')
    }
    const requestHash = hash({ action, releaseId, grants: [...grants].sort() })
    const op = await this.source.transaction(async (db) => {
      await db.query('SELECT id FROM app_users WHERE id=? FOR UPDATE', [
        userId,
      ])
      const [existing] = await db.query(
        'SELECT * FROM application_lifecycle_operations WHERE user_id=? AND app_id=? AND request_key=?',
        [userId, appId, key],
      )
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new ApiError(
            409,
            'APP_REQUEST_CONFLICT',
            '操作标识已被其他请求使用',
          )
        }
        return existing as Operation
      }
      const [row] = await db.query(
        'SELECT * FROM application_installations WHERE user_id=? AND app_id=? FOR UPDATE',
        [userId, appId],
      )
      if (row?.operation_id) {
        throw new ApiError(
          409,
          'APP_OPERATION_PENDING',
          '此应用有操作正在处理',
        )
      }
      const target = await this.release(
        action === 'uninstall' && row ? row.release_id : releaseId,
        db,
      )
      if (target.appId !== appId) {
        throw new ApiError(400, 'APP_RELEASE_MISMATCH', '应用版本不匹配')
      }
      if (action === 'uninstall' && target.kind === 'system') {
        throw new ApiError(403, 'SYSTEM_APP_REQUIRED', '系统应用不能卸载')
      }
      if (action === 'uninstall' && (!row || row.status === 'revoked')) {
        throw new ApiError(409, 'APP_ALREADY_REMOVED', '应用已经卸载')
      }
      if (action === 'update' && row?.status !== 'active') {
        throw new ApiError(409, 'APP_NOT_INSTALLED', '请先安装应用')
      }
      if (action === 'install' && row?.status === 'active') {
        throw new ApiError(409, 'APP_ALREADY_INSTALLED', '应用已经安装')
      }
      if (action !== 'uninstall') {
        const [pub] = await db.query(
          'SELECT published FROM application_releases WHERE release_id=?',
          [target.releaseId],
        )
        if (!pub?.published) {
          throw new ApiError(409, 'APP_RELEASE_UNPUBLISHED', '应用版本已下架')
        }
        if (
          target.permissions.some((p) => !grants.includes(p)) ||
          grants.some((p) => !target.permissions.includes(p))
        ) {
          throw new ApiError(
            400,
            'APP_PERMISSION_REQUIRED',
            '请确认此版本的应用权限',
          )
        }
      }
      const id = randomUUID()
      const generation =
        Number(row?.generation || 0) +
        (action === 'install' && row?.status !== 'installing' ? 1 : 0) || 1
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
      )
      const status =
        action === 'uninstall'
          ? 'revoked'
          : action === 'update'
            ? 'active'
            : 'installing'
      await db.query(
        `INSERT INTO application_installations(user_id,app_id,release_id,target_release_id,generation,status,grants,operation_id) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE target_release_id=VALUES(target_release_id),generation=VALUES(generation),status=VALUES(status),grants=IF(VALUES(status)='revoked',JSON_ARRAY(),grants),operation_id=VALUES(operation_id),updated_at=UTC_TIMESTAMP(3)`,
        [
          userId,
          appId,
          target.releaseId,
          action === 'uninstall' ? null : target.releaseId,
          generation,
          status,
          JSON.stringify(grants),
          id,
        ],
      )
      const [created] = await db.query(
        'SELECT * FROM application_lifecycle_operations WHERE id=?',
        [id],
      )
      return created as Operation
    })
    if (options.background) {
      void this.process(op.id).catch(() => {})
    } else {
      await this.process(op.id)
    }
    return this.operation(userId, op.id)
  }

  async operation(userId: string, id: string) {
    const [op] = await this.source.query(
      'SELECT id,app_id,action,status,receipt,error FROM application_lifecycle_operations WHERE id=? AND user_id=?',
      [id, userId],
    )
    if (!op) {
      throw new ApiError(404, 'APP_OPERATION_NOT_FOUND', '应用操作不存在')
    }
    return {
      id: op.id,
      appId: op.app_id,
      action: op.action,
      status: op.status,
      error: op.error,
      receipt: op.receipt ? json(op.receipt) : null,
    }
  }

  async recover() {
    await this.initialize()
    const bindings = [...this.backends.keys()]
    const owned = bindings.length ? `JSON_UNQUOTE(JSON_EXTRACT(r.definition,'$.backend.binding')) IN (${bindings.map(() => '?').join(',')})` : '0=1'
    const rows = await this.source.query(
      `SELECT o.id,o.release_id FROM application_lifecycle_operations o JOIN application_releases r ON r.release_id=o.release_id WHERE o.status IN ('queued','pending') AND o.next_attempt_at<=UTC_TIMESTAMP(3) AND (o.lease_until IS NULL OR o.lease_until<UTC_TIMESTAMP(3)) AND (JSON_UNQUOTE(JSON_EXTRACT(r.definition,'$.backend.type'))='none' OR ${owned}) ORDER BY o.created_at LIMIT 20`,
      bindings,
    )
    for (const row of rows) {
      try {
        const release = await this.release(row.release_id)
        if (release.backend.type !== 'none' && !this.backends.has(release.backend.binding)) {
          continue
        }
        await this.process(row.id)
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error
        }
        await this.source.query('UPDATE application_lifecycle_operations SET error=?,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 600 SECOND) WHERE id=?', [error.message.slice(0, 300), row.id])
      }
    }
    const failed = await this.source.query('SELECT i.user_id,i.app_id FROM application_installations i JOIN application_registry a ON a.app_id=i.app_id WHERE a.kind=\'system\' AND i.status=\'failed\' AND i.operation_id IS NULL AND i.retry_attempts<5 AND (i.retry_at IS NULL OR i.retry_at<=UTC_TIMESTAMP(3)) ORDER BY i.retry_at LIMIT 20')
    for (const row of failed) {
      try {
        await this.repair(row.user_id, row.app_id)
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error
        }
      }
    }
  }

  private async process(id: string) {
    const token = randomUUID()
    const claim = await this.source.query(
      `UPDATE application_lifecycle_operations SET lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND),attempts=attempts+1 WHERE id=? AND status IN ('queued','pending') AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))`,
      [token, id],
    )
    if (!claim.affectedRows) {
      return
    }
    const [op]: Operation[] = await this.source.query(
      'SELECT * FROM application_lifecycle_operations WHERE id=?',
      [id],
    )
    if (!op) {
      return
    }
    try {
      const release = await this.release(op.release_id)
      const backend = this.backends.get(release.backend.binding)
      if (release.backend.type !== 'none' && !backend) {
        await this.retry(id, token)
        return
      }
      const request = {
        operationId: op.id,
        appId: op.app_id,
        releaseId: op.release_id,
        subject: this.subject(op.user_id, op.app_id),
        generation: Number(op.generation),
        action: op.action,
      }
      let result: LifecycleReceipt | null =
        release.backend.type === 'none'
          ? { status: 'completed', receipt: {} }
          : op.submitted
            ? await backend!.operation(request)
            : null
      if (!result) {
        await this.source.query(
          'UPDATE application_lifecycle_operations SET submitted=1 WHERE id=? AND lease_token=?',
          [id, token],
        )
        result = backend
          ? await backend.lifecycle(request)
          : { status: 'completed', receipt: {} }
      }
      if (!result || result.status === 'pending') {
        await this.retry(id, token)
        return
      }
      await this.source.transaction(async (db) => {
        // Generation + operation fence prevents a stale worker from activating a reinstalled application.
        const [locked] = await db.query(
          'SELECT lease_token FROM application_lifecycle_operations WHERE id=? FOR UPDATE',
          [id],
        )
        if (locked?.lease_token !== token) {
          return
        }
        const [current] = await db.query(
          'SELECT * FROM application_installations WHERE user_id=? AND app_id=? FOR UPDATE',
          [op.user_id, op.app_id],
        )
        if (
          current?.operation_id !== id ||
          Number(current.generation) !== Number(op.generation)
        ) {
          return
        }
        const ok = result!.status === 'completed'
        if (ok && op.action !== 'uninstall') {
          await db.query(
            `UPDATE application_installations SET release_id=?,status='active',grants=?,target_release_id=NULL,operation_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND app_id=?`,
            [
              release.releaseId,
              JSON.stringify(release.permissions),
              op.user_id,
              op.app_id,
            ],
          )
        } else {
          await db.query(
            `UPDATE application_installations SET status=?,target_release_id=NULL,operation_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND app_id=?`,
            [
              op.action === 'uninstall'
                ? 'revoked'
                : op.action === 'update'
                  ? 'active'
                  : 'failed',
              op.user_id,
              op.app_id,
            ],
          )
        }
        await db.query('UPDATE application_installations SET error=?,retry_at=IF(?,NULL,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(600,10*POW(2,LEAST(6,retry_attempts))) SECOND)),retry_attempts=IF(?,0,retry_attempts+1) WHERE user_id=? AND app_id=?', [ok ? null : result!.status === 'rejected' ? result!.message.slice(0, 300) : '安装失败', ok, ok, op.user_id, op.app_id])
        await db.query(
          `UPDATE application_lifecycle_operations SET status=?,receipt=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=?`,
          [
            ok ? 'completed' : 'failed',
            ok
              ? JSON.stringify((result as { receipt: unknown }).receipt)
              : null,
            result!.status === 'rejected' ? result!.message : null,
            id,
            token,
          ],
        )
      })
    } catch {
      await this.retry(id, token)
    }
  }

  private async retry(id: string, token: string) {
    await this.source.query(
      `UPDATE application_lifecycle_operations SET status='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(600,10*POW(2,LEAST(6,attempts-1))) SECOND),error='应用服务尚未确认结果，正在核对',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_token=?`,
      [id, token],
    )
    await this.source.query('UPDATE application_installations SET error=\'应用服务尚未确认结果，正在核对\' WHERE operation_id=?', [id])
  }

  subject(userId: string, appId: string) {
    return createHash('sha256').update(`${appId}:${userId}`).digest('hex')
  }

  async runtime(
    userId: string,
    appId: string,
    platform: 'web' | 'android' | 'ios',
  ): Promise<RuntimeDescriptor> {
    const { installation, release } = await this.assertActive(userId, appId)
    if (release.runtime.type === 'shell' && this.options.shellMigrations?.includes(appId) && this.deploymentIssue(appId)) {
      throw new ApiError(503, 'APP_DEPLOYMENT_UNAVAILABLE', this.deploymentIssue(appId)!)
    }
    if (!release.platforms.includes(platform) || release.runtime.type !== 'web') {
      throw new ApiError(
        409,
        'APP_RUNTIME_UNSUPPORTED',
        '应用不支持此运行环境',
      )
    }
    if (process.env.NODE_ENV === 'production' || !release.runtime.integrity.endsWith('0'.repeat(64))) {
      try {
        await new ApplicationArtifacts().verify(appId, release.runtime.integrity.slice(7))
      } catch {
        throw new ApiError(503, 'APP_ARTIFACT_UNAVAILABLE', '此应用资源暂不可用，请重试或联系管理员检查部署')
      }
    }
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
    }
  }

  /** Runtime binding for both trusted shell modules and isolated web containers. */
  async context(
    userId: string,
    appId: string,
    platform: 'web' | 'android' | 'ios',
  ): Promise<ApplicationContext> {
    const { installation, release } = await this.assertActive(userId, appId)
    if (!release.platforms.includes(platform)) {
      throw new ApiError(
        409,
        'APP_RUNTIME_UNSUPPORTED',
        '应用不支持此运行环境',
      )
    }
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
        'runtime.context',
        'auth.session',
        'navigation.back',
        'navigation.open',
        ...(installation.grants.includes('files') ? ['files.pick' as const, 'files.upload' as const, 'files.read' as const] : []),
        ...(installation.grants.includes('api.request') ? ['api.request' as const] : []),
        ...(installation.grants.includes('device.reminders') ? ['device.reminders' as const] : []),
        ...(installation.grants.includes('resources.bindings') ? ['resources.bindings' as const] : []),
        ...(release.backend.type !== 'none' ? ['api.invoke' as const] : []),
        ...(installation.grants.includes('storage')
          ? [
              'storage.get' as const,
              'storage.set' as const,
              'storage.remove' as const,
            ]
          : []),
      ],
    }
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
    preparationTicket?: string,
  ) {
    const { installation, release } = await this.assertActive(userId, appId, {
      releaseId,
      generation,
    })
    if (!installation.grants.includes(`${appId}.${method}`)) {
      throw new ApiError(403, 'APP_PERMISSION_DENIED', '此应用没有该操作权限')
    }
    const backend = this.backends.get(release.backend.binding)
    if (!backend) {
      throw new ApiError(503, 'APP_BACKEND_UNAVAILABLE', '应用后端不可用')
    }
    return backend.invoke(
      {
        invocationId,
        appId,
        releaseId,
        subject: this.subject(userId, appId),
        generation,
        method,
        arguments: args,
        ...(preparationTicket ? { preparationTicket } : {}),
      },
      signal,
    )
  }

  async prepare(userId: string, input: { invocation: Omit<import('@t-box/app-contracts').BackendInvocation, 'subject'>, continuation?: string, response?: import('@t-box/app-contracts').BackendPreparation['response'] }, signal?: AbortSignal) {
    const invocation = input.invocation
    const { installation, release } = await this.assertActive(userId, invocation.appId, invocation)
    if (!installation.grants.includes(`${invocation.appId}.${invocation.method}`)) {
      throw new ApiError(403, 'APP_PERMISSION_DENIED', '此应用没有该操作权限')
    }
    const backend = this.backends.get(release.backend.binding)
    if (!backend?.prepare) {
      throw new ApiError(409, 'APP_PREPARATION_UNSUPPORTED', '应用后端未提供执行前交互协议')
    }
    return backend.prepare({ ...input, invocation: { ...invocation, subject: this.subject(userId, invocation.appId) } }, signal)
  }

  async events(userId: string, appId: string, input: { releaseId: string, generation: number, channel: string, cursor?: string, arguments?: unknown }, signal?: AbortSignal) {
    const { installation, release } = await this.assertActive(userId, appId, input)
    if (!installation.grants.includes(`events.${input.channel}`)) {
      throw new ApiError(403, 'APP_PERMISSION_DENIED', '此应用没有该事件权限')
    }
    const backend = this.backends.get(release.backend.binding)
    if (!backend?.events) {
      throw new ApiError(409, 'APP_EVENTS_UNSUPPORTED', '应用后端未提供此事件通道')
    }
    const result = await backend.events({ ...input, appId, subject: this.subject(userId, appId) }, signal)
    if (!result || typeof result.cursor !== 'string' || result.cursor.length > 4096 || !Array.isArray(result.events) || result.events.length > 50 || JSON.stringify(result).length > 256_000) {
      throw new ApiError(502, 'APP_PROTOCOL_INVALID', '应用事件协议无效')
    }
    await this.assertActive(userId, appId, input)
    return result
  }
}
