import type {
  AppInstallation,
  ApplicationContext,
  AppRelease,
  InstalledApplicationAction,
  LifecycleAction,
  LifecycleReceipt,
  MarketEntry,
  RuntimeDescriptor,
} from '@t-box/app-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { StoredApplicationInstallation } from '../db/records/applications-entities.js'
import type { ApplicationBackend } from './adapters/contracts.js'
import { createHash, randomUUID } from 'node:crypto'
import { APP_SDK_VERSION, validateRelease } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { jsonDocument } from '@t-box/server-foundation/persistence/columns'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { In, IsNull } from 'typeorm'
import {
  ApplicationInstallationEntity,
  ApplicationLifecycleOperationEntity,
  ApplicationPublicationEventEntity,
  ApplicationRegistryEntity,
  ApplicationReleaseEntity,
} from '../db/records/applications-entities.js'
import { ErrorCode } from '../error-codes.js'
import { HostDownloadConfiguration } from './download-settings.js'
import { publicLocalReleases } from './public-local.js'
import { ApplicationMarketPolicy } from './settings.js'

const json = <T>(value: unknown): T =>
  typeof value === 'string' ? JSON.parse(value) : (value as T)
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex')
interface Operation {
  id: string
  user_id: string
  app_id: string
  release_id: string
  generation: number
  action: LifecycleAction
  submitted: number | boolean
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
  readonly marketPolicy: ApplicationMarketPolicy
  readonly downloads: HostDownloadConfiguration
  private catalogStamp = ''
  constructor(
    private readonly source: DataSource,
    private readonly releases: readonly AppRelease[],
    private readonly kinds: Readonly<Record<string, AppRelease['kind']>> = {},
    private readonly options: {
      shellMigrations?: readonly string[]
      deploymentIssues?: Record<string, string>
      marketPolicy?: ApplicationMarketPolicy
      downloads?: HostDownloadConfiguration
    } = {},
  ) {
    this.marketPolicy = options.marketPolicy ?? new ApplicationMarketPolicy(source)
    this.downloads = options.downloads ?? new HostDownloadConfiguration(source)
  }

  bind(name: string, backend: ApplicationBackend) {
    if (this.backends.has(name)) {
      throw ErrorCode.INTERNAL_DUPLICATE_BACKEND_BINDING()
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
    await this.marketPolicy.initialize()
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
          await db
            .createQueryBuilder()
            .insert()
            .into('application_registry')
            .values({
              app_id: () => ':p0',
              kind: () => ':p1',
              created_at: () => 'UTC_TIMESTAMP(3)',
            })
            .updateEntity(false)
            .setParameters({
              p0: release.appId,
              p1: this.kinds[release.appId] ?? release.kind,
            })
            .orUpdate(['app_id'])
            .execute()
          const policy = await db
            .getRepository(ApplicationRegistryEntity)
            .findOne({
              select: { kind: true },
              where: { app_id: release.appId },
              lock: { mode: 'pessimistic_write' },
            })
          const old = await db.getRepository(ApplicationReleaseEntity).findOne({
            select: { definition: true, definition_hash: true },
            where: { release_id: release.releaseId },
            lock: { mode: 'pessimistic_write' },
          })
          if (!policy) {
            throw ErrorCode.APP_NOT_FOUND()
          }
          if (old && old.definition_hash !== hash(release)) {
            // Kind moved to the app-level registry in the publishing migration. Preserve the historical definition and hash.
            const historical = json<AppRelease>(old.definition)
            if (
              policy.kind !== release.kind ||
              hash({ ...release, kind: historical.kind }) !==
              old.definition_hash
            ) {
              throw ErrorCode.INTERNAL_IMMUTABLE_RELEASE_CHANGED(
                `Immutable release changed: ${release.releaseId}`,
              )
            }
          }
          const known = await db
            .getRepository(ApplicationReleaseEntity)
            .findOne({
              select: { release_id: true },
              where: { app_id: release.appId },
            })
          // Only trusted code/deployment can register executable bindings. User installation never registers services.
          await db
            .createQueryBuilder()
            .insert()
            .into('application_releases')
            .values({
              release_id: release.releaseId,
              app_id: release.appId,
              definition: () => ':p2',
              definition_hash: hash(release),
              published: known ? 0 : 1,
              status: known ? 'submitted' : 'published',
              created_at: () => 'UTC_TIMESTAMP(3)',
            })
            .updateEntity(false)
            .orIgnore()
            .setParameters({ p2: JSON.stringify(release) })
            .execute()
          if (!old && !known) {
            await db
              .createQueryBuilder()
              .update('application_releases')
              .set({
                published: () => '(release_id=:p0)',
                status: () =>
                  'IF(release_id=:p1,\'published\',IF(status=\'published\',\'retired\',status))',
              })
              .updateEntity(false)
              .where('app_id=:p2')
              .setParameters({
                p0: release.releaseId,
                p1: release.releaseId,
                p2: release.appId,
              })
              .execute()
          }
          if (
            this.options.shellMigrations?.includes(release.appId) &&
            release.runtime.type === 'web'
          ) {
            const legacy = await db
              .getRepository(ApplicationReleaseEntity)
              .findOne({
                select: { release_id: true, definition: true },
                where: { app_id: release.appId, published: 1 },
              })
            if (
              legacy &&
              json<AppRelease>(legacy.definition).runtime.type === 'shell'
            ) {
              await db.getRepository(ApplicationReleaseEntity).update(
                { release_id: legacy.release_id },
                {
                  published: 0,
                  status: 'retired',
                  revision: () => 'revision+1',
                },
              )
              await db.getRepository(ApplicationReleaseEntity).update(
                { release_id: release.releaseId },
                {
                  published: 1,
                  status: 'published',
                  published_at: () => 'UTC_TIMESTAMP(3)',
                  revision: () => 'revision+1',
                },
              )
              await db.getRepository(ApplicationPublicationEventEntity).insert({
                id: randomUUID(),
                app_id: release.appId,
                release_id: release.releaseId,
                action: 'migrate_runtime',
                administrator_id: '00000000-0000-0000-0000-000000000000',
                detail: {
                  from: legacy.release_id,
                  origin: 'trusted_deployment',
                },
              })
            }
          }
        })
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          ('driverError' in error ||
            (error as { name?: string }).name === 'QueryFailedError')
        ) {
          throw error
        }
        this.faults.set(
          release.appId,
          '应用版本定义不兼容，请管理员检查部署配置',
        )
      }
    }
  }

  async release(
    id: string,
    db: EntityManager | DataSource = this.source,
  ): Promise<AppRelease> {
    const [row] = await db
      .createQueryBuilder()
      .select('r.definition,a.kind')
      .from('application_releases', 'r')
      .innerJoin('application_registry', 'a', 'a.app_id=r.app_id')
      .where('r.release_id=:p0')
      .setParameters({ p0: id })
      .getRawMany()
    if (!row) {
      throw ErrorCode.APP_RELEASE_NOT_FOUND('应用版本不存在')
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
    return (
      this.faults.get(appId) || this.options.deploymentIssues?.[appId] || null
    )
  }

  private installation(
    row: Pick<
      StoredApplicationInstallation,
      | 'app_id' |
      'release_id' |
      'target_release_id' |
      'generation' |
      'status' |
      'operation_id' |
      'grants' |
      'error'
    > & { installed_version?: unknown },
  ): AppInstallation {
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
      await this.source.getRepository(ApplicationReleaseEntity).find({
        select: { app_id: true, release_id: true },
        where: { published: 1 },
        order: { app_id: 'ASC' },
      }),
    )
    if (stamp !== this.catalogStamp) {
      this.catalogStamp = stamp
      this.bootstraps.clear()
      this.bootstrapTimes.clear()
    }
    const existing = this.bootstraps.get(userId)
    if (
      existing &&
      Date.now() - (this.bootstrapTimes.get(userId) || 0) < 10_000
    ) {
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
    const defaults = await this.source
      .createQueryBuilder()
      .select('r.definition,a.kind')
      .from('application_releases', 'r')
      .innerJoin('application_registry', 'a', 'a.app_id=r.app_id')
      .where(
        'r.published=1 AND (a.kind=\'system\' OR JSON_EXTRACT(r.definition,\'$.defaultInstalled\')=true)',
      )
      .getRawMany()
    for (const published of defaults) {
      const r = json<AppRelease>(published.definition)
      try {
        if (published.kind === 'system') {
          await this.source.getRepository(ApplicationInstallationEntity).update(
            {
              user_id: userId,
              app_id: r.appId,
              status: 'revoked',
              operation_id: IsNull(),
            },
            { status: 'installing', generation: () => 'generation+1' },
          )
        }
        await this.source
          .createQueryBuilder()
          .insert()
          .into('application_installations')
          .values({
            user_id: userId,
            app_id: r.appId,
            release_id: r.releaseId,
            status: 'installing',
            grants: () => ':p3',
          })
          .updateEntity(false)
          .orIgnore()
          .setParameters({ p3: JSON.stringify(r.permissions) })
          .execute()
        const [row] = await this.source
          .createQueryBuilder()
          .select(
            'user_id,app_id,release_id,target_release_id,generation,status,grants,operation_id,updated_at,error,retry_attempts,retry_at,(retry_at IS NULL OR retry_at<=UTC_TIMESTAMP(3)) AS retry_ready',
          )
          .from('application_installations', 'application_installations')
          .where('user_id=:p0 AND app_id=:p1')
          .setParameters({ p0: userId, p1: r.appId })
          .getRawMany()
        if (
          row?.status === 'active' &&
          !row.operation_id &&
          r.runtime.type === 'web' &&
          this.options.shellMigrations?.includes(r.appId)
        ) {
          const installed = await this.release(row.release_id)
          if (installed.runtime.type === 'shell') {
            await this.source.transaction(async (db) => {
              await db
                .getRepository(AppUserEntity)
                .find({
                  select: { id: true },
                  where: { id: userId },
                  lock: { mode: 'pessimistic_write' },
                })
                .then((rows) => rows.map((row) => ({ id: row.id })))
              await db.getRepository(ApplicationInstallationEntity).update(
                {
                  user_id: userId,
                  app_id: r.appId,
                  release_id: row.release_id,
                  status: 'active',
                  operation_id: IsNull(),
                },
                {
                  release_id: r.releaseId,
                  generation: () => 'generation+1',
                  grants: r.permissions,
                  error: null,
                },
              )
            })
          }
        }
        if (
          published.kind === 'system' &&
          row?.status === 'failed' &&
          Number(row.retry_attempts) < 5 &&
          Number(row.retry_ready)
        ) {
          await this.source.getRepository(ApplicationInstallationEntity).update(
            {
              user_id: userId,
              app_id: r.appId,
              status: 'failed',
              operation_id: IsNull(),
            },
            { status: 'installing', generation: () => 'generation+1' },
          )
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
        await this.source
          .getRepository(ApplicationInstallationEntity)
          .update(
            { user_id: userId, app_id: r.appId },
            { error: error.message.slice(0, 300) },
          )
      }
    }
  }

  async publicLocalCatalog(): Promise<AppRelease[]> {
    await this.initialize()
    const allowed = new Set(this.releases.filter((release) => release.guestAccess === 'local').map((release) => release.appId))
    if (!allowed.size) {
      return []
    }
    const applications = await this.source.getRepository(ApplicationRegistryEntity).find({ where: { app_id: In([...allowed]), kind: 'system' }, select: { app_id: true } })
    if (!applications.length) {
      return []
    }
    const rows = await this.source.getRepository(ApplicationReleaseEntity).find({
      where: { app_id: In(applications.map((entry) => entry.app_id)), published: 1, status: 'published' },
      select: { definition: true },
      order: { app_id: 'ASC' },
    })
    return publicLocalReleases(rows.map((row) => json<AppRelease>(row.definition)), allowed, process.env.NODE_ENV !== 'production')
  }

  async catalog(userId: string): Promise<MarketEntry[]> {
    await this.bootstrap(userId)
    const rows = await this.source
      .createQueryBuilder()
      .select(
        'r.definition,a.kind,i.user_id,i.app_id,i.release_id,i.target_release_id,i.generation,i.status,i.grants,i.operation_id,i.error,JSON_UNQUOTE(JSON_EXTRACT(installed.definition,\'$.manifest.version\')) AS installed_version,r.release_notes AS latest_release_notes,JSON_EXTRACT(installed.definition,\'$.updatePrompt\') AS installed_update_prompt',
      )
      .from('application_releases', 'r')
      .addSelect('installed.definition', 'installed_definition')
      .innerJoin('application_registry', 'a', 'a.app_id=r.app_id')
      .leftJoin(
        'application_installations',
        'i',
        'i.app_id=r.app_id AND i.user_id=:p0',
      )
      .leftJoin(
        'application_releases',
        'installed',
        'installed.release_id=i.release_id',
      )
      .where('r.published=1')
      .orderBy('r.created_at', 'ASC')
      .addOrderBy('r.app_id', 'ASC')
      .setParameters({ p0: userId })
      .getRawMany<
        Pick<
          StoredApplicationInstallation,
          | 'user_id' |
          'app_id' |
          'release_id' |
          'target_release_id' |
          'generation' |
          'status' |
          'grants' |
          'operation_id' |
          'error'
        > & {
          definition: AppRelease | string
          kind: AppRelease['kind']
          installed_version: string | null
          latest_release_notes: string
          installed_update_prompt: string | null
          installed_definition: AppRelease | string | null
        }
    >()
    return rows.map((r) => ({
      release: {
        ...json<AppRelease>(r.definition as string),
        kind: r.kind as AppRelease['kind'],
      },
      releaseNotes: String(r.latest_release_notes || ''),
      ...(r.user_id && r.installed_definition ? { installedRelease: json<AppRelease>(r.installed_definition) } : {}),
      ...(r.user_id && r.status === 'active' && r.installed_definition
        ? {
            localBinding: {
              subject: this.subject(userId, String(r.app_id)),
              storage: json<string[]>(r.grants as string).includes('storage'),
            },
          }
        : {}),
      ...(r.installed_update_prompt
        ? {
            installedUpdatePrompt: json<
              NonNullable<MarketEntry['installedUpdatePrompt']>
            >(r.installed_update_prompt as string),
          }
        : {}),
      installation: r.user_id ? this.installation(r) : null,
      issue:
        r.status === 'active' ? null : this.deploymentIssue(String(r.app_id)),
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
    const releaseRow = await this.source
      .getRepository(ApplicationReleaseEntity)
      .findOne({
        select: { definition: true },
        where: { app_id: appId, published: 1 },
      })
    if (!releaseRow) {
      throw ErrorCode.APP_DEPLOYMENT_UNAVAILABLE(
        this.deploymentIssue(appId) || '应用版本尚未部署',
      )
    }
    const release = json<AppRelease>(releaseRow.definition)
    const row = await this.source
      .getRepository(ApplicationInstallationEntity)
      .findOne({
        select: {
          user_id: true,
          app_id: true,
          release_id: true,
          target_release_id: true,
          generation: true,
          status: true,
          grants: true,
          operation_id: true,
          updated_at: true,
          error: true,
          retry_attempts: true,
          retry_at: true,
        },
        where: { user_id: userId, app_id: appId },
      })
    if (row?.status === 'active' && !row.operation_id) {
      return { status: 'completed' }
    }
    if (row?.operation_id) {
      await this.process(row.operation_id)
      return this.operation(userId, row.operation_id)
    }
    if ((!row || row.status === 'revoked') && release.kind !== 'system') {
      throw ErrorCode.APP_NOT_INSTALLED()
    }
    const result = await this.change(
      userId,
      appId,
      'install',
      release.releaseId,
      randomUUID(),
      release.permissions,
      { background: release.backend.type === 'remote' },
    )
    this.bootstraps.delete(userId)
    return result
  }

  async assertActive(
    userId: string,
    appId: string,
    expected?: { releaseId: string, generation: number },
  ) {
    await this.bootstrap(userId)
    const row = await this.source
      .getRepository(ApplicationInstallationEntity)
      .findOne({
        select: {
          user_id: true,
          app_id: true,
          release_id: true,
          target_release_id: true,
          generation: true,
          status: true,
          grants: true,
          operation_id: true,
          updated_at: true,
          error: true,
          retry_attempts: true,
          retry_at: true,
        },
        where: { user_id: userId, app_id: appId },
      })
    if (!row || row.status !== 'active') {
      throw ErrorCode.APP_NOT_INSTALLED('请先在应用市场安装此应用')
    }
    const installation = this.installation(row)
    if (
      expected &&
      (expected.releaseId !== installation.releaseId ||
        expected.generation !== installation.generation)
    ) {
      throw ErrorCode.APP_RUNTIME_EXPIRED(
        '应用版本或安装状态已改变，请重新打开',
      )
    }
    const release = await this.release(installation.releaseId)
    if (
      release.permissions.some(
        (permission) => !installation.grants.includes(permission),
      )
    ) {
      throw ErrorCode.APP_PERMISSION_REVOKED()
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
    options: { background?: boolean, rollbackFrom?: string } = {},
  ) {
    await this.initialize()
    if (!/^[\w-]{1,80}$/.test(key)) {
      throw ErrorCode.INVALID_REQUEST_KEY()
    }
    const requestHash = hash({ action, releaseId, grants: [...grants].sort(), ...(options.rollbackFrom ? { rollbackFrom: options.rollbackFrom } : {}) })
    const op = await this.source.transaction(async (db) => {
      await db
        .getRepository(AppUserEntity)
        .find({
          select: { id: true },
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        })
        .then((rows) => rows.map((row) => ({ id: row.id })))
      const existing = await db
        .getRepository(ApplicationLifecycleOperationEntity)
        .findOne({
          select: {
            id: true,
            user_id: true,
            app_id: true,
            request_key: true,
            request_hash: true,
            release_id: true,
            generation: true,
            action: true,
            status: true,
            submitted: true,
            attempts: true,
            lease_token: true,
            lease_until: true,
            next_attempt_at: true,
            receipt: true,
            error: true,
            created_at: true,
            updated_at: true,
          },
          where: { user_id: userId, app_id: appId, request_key: key },
        })
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw ErrorCode.APP_REQUEST_CONFLICT()
        }
        return existing as Operation
      }
      const row = await db
        .getRepository(ApplicationInstallationEntity)
        .findOne({
          select: {
            user_id: true,
            app_id: true,
            release_id: true,
            target_release_id: true,
            generation: true,
            status: true,
            grants: true,
            operation_id: true,
            updated_at: true,
            error: true,
            retry_attempts: true,
            retry_at: true,
          },
          where: { user_id: userId, app_id: appId },
          lock: { mode: 'pessimistic_write' },
        })
      if (row?.operation_id) {
        throw ErrorCode.APP_OPERATION_PENDING()
      }
      if (options.rollbackFrom) {
        // Revalidate inside the same installation lock: stale devices cannot undo a later update.
        if (action !== 'update' || row?.status !== 'active' || row.release_id !== options.rollbackFrom || releaseId === options.rollbackFrom) {
          throw ErrorCode.APP_ROLLBACK_REJECTED()
        }
        const prior = await db.getRepository(ApplicationLifecycleOperationEntity).findOne({
          select: { id: true },
          where: { user_id: userId, app_id: appId, release_id: releaseId, action: In(['install', 'update']), status: 'completed' },
        })
        const currentGrants = json<string[]>(row.grants)
        if (!prior || !Array.isArray(currentGrants) || grants.some((permission) => !currentGrants.includes(permission))) {
          throw ErrorCode.APP_ROLLBACK_REJECTED()
        }
      }
      const target = await this.release(
        action === 'uninstall' && row ? row.release_id : releaseId,
        db,
      )
      if (action === 'install' && target.kind !== 'system' && (!row || row.status === 'revoked') && (await this.marketPolicy.read(db)).hidden) {
        throw ErrorCode.APP_MARKET_HIDDEN()
      }
      if (target.appId !== appId) {
        throw ErrorCode.APP_RELEASE_MISMATCH()
      }
      if (action === 'uninstall' && target.kind === 'system') {
        throw ErrorCode.SYSTEM_APP_REQUIRED()
      }
      if (action === 'uninstall' && (!row || row.status === 'revoked')) {
        throw ErrorCode.APP_ALREADY_REMOVED()
      }
      if (action === 'update' && row?.status !== 'active') {
        throw ErrorCode.APP_NOT_INSTALLED.conflict()
      }
      if (action === 'install' && row?.status === 'active') {
        throw ErrorCode.APP_ALREADY_INSTALLED()
      }
      if (action !== 'uninstall') {
        const pub = await db.getRepository(ApplicationReleaseEntity).findOne({
          select: { published: true, status: true },
          where: { release_id: target.releaseId },
        })
        // Normal publication retires the previous immutable version. A proven historical install
        // can roll back to it; a draft/submission can never become executable via rollback.
        if (!pub?.published && !(options.rollbackFrom && pub?.status === 'retired')) {
          throw ErrorCode.APP_RELEASE_UNPUBLISHED()
        }
        if (
          target.permissions.some((p) => !grants.includes(p)) ||
          grants.some((p) => !target.permissions.includes(p))
        ) {
          throw ErrorCode.APP_PERMISSION_REQUIRED()
        }
      }
      const id = randomUUID()
      const generation =
        Number(row?.generation || 0) +
        (action === 'install' && row?.status !== 'installing' ? 1 : 0) || 1
      await db.getRepository(ApplicationLifecycleOperationEntity).insert({
        id,
        user_id: userId,
        app_id: appId,
        request_key: key,
        request_hash: requestHash,
        release_id: target.releaseId,
        generation,
        action,
        created_at: () => 'UTC_TIMESTAMP(3)',
        updated_at: () => 'UTC_TIMESTAMP(3)',
        next_attempt_at: () => 'UTC_TIMESTAMP(3)',
      })
      const status =
        action === 'uninstall'
          ? 'revoked'
          : action === 'update'
            ? 'active'
            : 'installing'
      // native-sql: atomic counter, cooldown or permission merge; preserve existing-row expressions
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
      const created = await db
        .getRepository(ApplicationLifecycleOperationEntity)
        .findOne({
          select: {
            id: true,
            user_id: true,
            app_id: true,
            request_key: true,
            request_hash: true,
            release_id: true,
            generation: true,
            action: true,
            status: true,
            submitted: true,
            attempts: true,
            lease_token: true,
            lease_until: true,
            next_attempt_at: true,
            receipt: true,
            error: true,
            created_at: true,
            updated_at: true,
          },
          where: { id },
        })
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
    const op = await this.source
      .getRepository(ApplicationLifecycleOperationEntity)
      .findOne({
        select: {
          id: true,
          app_id: true,
          action: true,
          status: true,
          receipt: true,
          error: true,
        },
        where: { id, user_id: userId },
      })
    if (!op) {
      throw ErrorCode.APP_OPERATION_NOT_FOUND()
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
    const noBackend =
      'JSON_UNQUOTE(JSON_EXTRACT(r.definition,\'$.backend.type\'))=\'none\''
    const rows = await this.source
      .createQueryBuilder()
      .select('o.id,o.release_id')
      .from('application_lifecycle_operations', 'o')
      .innerJoin('application_releases', 'r', 'r.release_id=o.release_id')
      .where(
        'o.status IN (\'queued\',\'pending\') AND o.next_attempt_at<=UTC_TIMESTAMP(3) AND (o.lease_until IS NULL OR o.lease_until<UTC_TIMESTAMP(3))',
      )
      .andWhere(
        bindings.length
          ? `(${noBackend} OR JSON_UNQUOTE(JSON_EXTRACT(r.definition,'$.backend.binding')) IN (:...bindings))`
          : noBackend,
        { bindings },
      )
      .orderBy('o.created_at', 'ASC')
      .limit(20)
      .getRawMany()
    for (const row of rows) {
      try {
        const release = await this.release(row.release_id)
        if (
          release.backend.type !== 'none' &&
          !this.backends.has(release.backend.binding)
        ) {
          continue
        }
        await this.process(row.id)
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error
        }
        await this.source
          .getRepository(ApplicationLifecycleOperationEntity)
          .update(
            { id: row.id },
            {
              error: error.message.slice(0, 300),
              next_attempt_at: () =>
                'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 600 SECOND)',
            },
          )
      }
    }
    const failed = await this.source
      .createQueryBuilder()
      .select('i.user_id,i.app_id')
      .from('application_installations', 'i')
      .innerJoin('application_registry', 'a', 'a.app_id=i.app_id')
      .where(
        'a.kind=\'system\' AND i.status=\'failed\' AND i.operation_id IS NULL AND i.retry_attempts<5 AND (i.retry_at IS NULL OR i.retry_at<=UTC_TIMESTAMP(3))',
      )
      .orderBy('i.retry_at', 'ASC')
      .limit(20)
      .getRawMany()
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
    const claim = await this.source
      .createQueryBuilder()
      .update('application_lifecycle_operations')
      .set({
        lease_token: token,
        lease_until: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND)',
        attempts: () => 'attempts+1',
      })
      .updateEntity(false)
      .where(
        'id=:p1 AND status IN (\'queued\',\'pending\') AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))',
      )
      .setParameters({ p1: id })
      .execute()
    if (!claim.affected) {
      return
    }
    const op = await this.source
      .getRepository(ApplicationLifecycleOperationEntity)
      .findOne({
        select: {
          id: true,
          user_id: true,
          app_id: true,
          request_key: true,
          request_hash: true,
          release_id: true,
          generation: true,
          action: true,
          status: true,
          submitted: true,
          attempts: true,
          lease_token: true,
          lease_until: true,
          next_attempt_at: true,
          receipt: true,
          error: true,
          created_at: true,
          updated_at: true,
        },
        where: { id },
      })
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
        await this.source
          .getRepository(ApplicationLifecycleOperationEntity)
          .update({ id, lease_token: token }, { submitted: 1 })
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
        const locked = await db
          .getRepository(ApplicationLifecycleOperationEntity)
          .findOne({
            select: { id: true, lease_token: true },
            where: { id },
            lock: { mode: 'pessimistic_write' },
          })
        if (locked?.lease_token !== token) {
          return
        }
        const current = await db
          .getRepository(ApplicationInstallationEntity)
          .findOne({
            select: {
              user_id: true,
              app_id: true,
              release_id: true,
              target_release_id: true,
              generation: true,
              status: true,
              grants: true,
              operation_id: true,
              updated_at: true,
              error: true,
              retry_attempts: true,
              retry_at: true,
            },
            where: { user_id: op.user_id, app_id: op.app_id },
            lock: { mode: 'pessimistic_write' },
          })
        if (
          current?.operation_id !== id ||
          Number(current.generation) !== Number(op.generation)
        ) {
          return
        }
        const ok = result!.status === 'completed'
        if (ok && op.action !== 'uninstall') {
          await db.getRepository(ApplicationInstallationEntity).update(
            { user_id: op.user_id, app_id: op.app_id },
            {
              release_id: release.releaseId,
              status: 'active',
              grants: release.permissions,
              target_release_id: null,
              operation_id: null,
              updated_at: () => 'UTC_TIMESTAMP(3)',
            },
          )
        } else {
          await db.getRepository(ApplicationInstallationEntity).update(
            { user_id: op.user_id, app_id: op.app_id },
            {
              status:
                op.action === 'uninstall'
                  ? 'revoked'
                  : op.action === 'update'
                    ? 'active'
                    : 'failed',
              target_release_id: null,
              operation_id: null,
              updated_at: () => 'UTC_TIMESTAMP(3)',
            },
          )
        }
        await db
          .createQueryBuilder()
          .update('application_installations')
          .set({
            error: ok
              ? null
              : result!.status === 'rejected'
                ? result!.message.slice(0, 300)
                : '安装失败',
            retry_at: () =>
              'IF(:p1,NULL,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(600,10*POW(2,LEAST(6,retry_attempts))) SECOND))',
            retry_attempts: () => 'IF(:p2,0,retry_attempts+1)',
          })
          .updateEntity(false)
          .where('user_id=:p3 AND app_id=:p4')
          .setParameters({ p1: ok, p2: ok, p3: op.user_id, p4: op.app_id })
          .execute()
        await db.getRepository(ApplicationLifecycleOperationEntity).update(
          { id, lease_token: token },
          {
            status: ok ? 'completed' : 'failed',
            receipt: ok
              ? jsonDocument((result as { receipt: unknown }).receipt)
              : null,
            error: result!.status === 'rejected' ? result!.message : null,
            lease_token: null,
            lease_until: null,
            updated_at: () => 'UTC_TIMESTAMP(3)',
          },
        )
      })
    } catch {
      await this.retry(id, token)
    }
  }

  private async retry(id: string, token: string) {
    await this.source.transaction(async (db) => {
      const changed = await db
        .getRepository(ApplicationLifecycleOperationEntity)
        .update(
          { id, lease_token: token },
          {
            status: 'pending',
            lease_token: null,
            lease_until: null,
            next_attempt_at: () =>
              'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(600,10*POW(2,LEAST(6,GREATEST(CAST(attempts AS SIGNED)-1,0)))) SECOND)',
            error: '应用服务尚未确认结果，正在核对',
            updated_at: () => 'UTC_TIMESTAMP(3)',
          },
        )
      if (!changed.affected) {
        return
      }
      await db
        .getRepository(ApplicationInstallationEntity)
        .update(
          { operation_id: id },
          { error: '应用服务尚未确认结果，正在核对' },
        )
    })
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
    if (
      release.runtime.type === 'shell' &&
      this.options.shellMigrations?.includes(appId) &&
      this.deploymentIssue(appId)
    ) {
      throw ErrorCode.APP_DEPLOYMENT_UNAVAILABLE(this.deploymentIssue(appId)!)
    }
    if (
      !release.platforms.includes(platform) ||
      release.runtime.type !== 'web'
    ) {
      throw ErrorCode.APP_RUNTIME_UNSUPPORTED()
    }
    // Publication verifies the immutable artifact. Devices verify downloaded bytes.
    // Never download an entire package again in the authenticated launch path.
    return {
      protocol: 1,
      appId,
      releaseId: release.releaseId,
      generation: installation.generation,
      entryUrl: release.runtime.entryUrl,
      origin: new URL(release.runtime.entryUrl).origin,
      subject: this.subject(userId, appId),
      clientTools: release.clientTools,
      integrity: release.runtime.integrity,
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
      throw ErrorCode.APP_RUNTIME_UNSUPPORTED()
    }
    return {
      sdkVersion: APP_SDK_VERSION,
      appId,
      releaseId: release.releaseId,
      applicationVersion: release.manifest.version,
      generation: installation.generation,
      subject: this.subject(userId, appId),
      platform,
      updatePrompt: release.updatePrompt,
      runtime: release.runtime.type,
      params: {},
      permissions: installation.grants,
      capabilities: [
        'updates.getAvailable',
        'updates.openMarket',
        'updates.presentation',
        'updates.respond',
        'runtime.context',
        'auth.session',
        'navigation.back',
        'navigation.open',
        ...(installation.grants.includes('files.private') ? ['files.private.pick' as const, 'files.private.upload' as const, 'files.private.read' as const] : []),
        ...(installation.grants.includes('files')
          ? [
              'files.pick' as const,
              'files.upload' as const,
              'files.read' as const,
            ]
          : []),
        ...(installation.grants.includes('api.request')
          ? ['api.request' as const]
          : []),
        ...(installation.grants.includes('device.reminders')
          ? ['device.reminders' as const]
          : []),
        ...(installation.grants.includes('resources.bindings')
          ? ['resources.bindings' as const]
          : []),
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

  async actions(userId: string): Promise<InstalledApplicationAction[]> {
    const catalog = await this.catalog(userId)
    return catalog.flatMap((entry) => {
      if (entry.installation?.status !== 'active') {
        return []
      }
      const release = entry.installedRelease ?? entry.release
      return (this.backends.get(release.backend.binding)?.actions ?? release.actions ?? []).filter((action) => entry.installation!.grants.includes(`${release.appId}.${action.id}`)).map((action) => ({ ...action, appId: release.appId, releaseId: release.releaseId, generation: entry.installation!.generation }))
    })
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
      throw ErrorCode.APP_PERMISSION_DENIED()
    }
    const backend = this.backends.get(release.backend.binding)
    if (!backend) {
      throw ErrorCode.APP_BACKEND_UNAVAILABLE.unavailable()
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

  async prepare(
    userId: string,
    input: {
      invocation: Omit<
        import('@t-box/app-contracts').BackendInvocation,
        'subject'
      >
      continuation?: string
      response?: import('@t-box/app-contracts').BackendPreparation['response']
    },
    signal?: AbortSignal,
  ) {
    const invocation = input.invocation
    const { installation, release } = await this.assertActive(
      userId,
      invocation.appId,
      invocation,
    )
    if (
      !installation.grants.includes(`${invocation.appId}.${invocation.method}`)
    ) {
      throw ErrorCode.APP_PERMISSION_DENIED()
    }
    const backend = this.backends.get(release.backend.binding)
    if (!backend?.prepare) {
      throw ErrorCode.APP_PREPARATION_UNSUPPORTED()
    }
    return backend.prepare(
      {
        ...input,
        invocation: {
          ...invocation,
          subject: this.subject(userId, invocation.appId),
        },
      },
      signal,
    )
  }

  async events(
    userId: string,
    appId: string,
    input: {
      releaseId: string
      generation: number
      channel: string
      cursor?: string
      arguments?: unknown
    },
    signal?: AbortSignal,
  ) {
    const { installation, release } = await this.assertActive(
      userId,
      appId,
      input,
    )
    if (!installation.grants.includes(`events.${input.channel}`)) {
      throw ErrorCode.APP_PERMISSION_DENIED('此应用没有该事件权限')
    }
    const backend = this.backends.get(release.backend.binding)
    if (!backend?.events) {
      throw ErrorCode.APP_EVENTS_UNSUPPORTED()
    }
    const result = await backend.events(
      { ...input, appId, subject: this.subject(userId, appId) },
      signal,
    )
    if (
      !result ||
      typeof result.cursor !== 'string' ||
      result.cursor.length > 4096 ||
      !Array.isArray(result.events) ||
      result.events.length > 50 ||
      JSON.stringify(result).length > 256_000
    ) {
      throw ErrorCode.APP_PROTOCOL_INVALID()
    }
    await this.assertActive(userId, appId, input)
    return result
  }
}
