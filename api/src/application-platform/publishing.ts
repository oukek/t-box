import type { ApplicationPublicationEvent, AppRelease, ManagedApplication, ManagedRelease } from '@t-box/app-contracts'
import type { DataSource, EntityManager } from 'typeorm'
import type { ApplicationPlatform } from './service.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  validApplicationIcon,
  validateRelease,
  validId,
} from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { isoTime } from '@t-box/server-foundation/time'
import { ApplicationArtifacts } from './artifacts.js'

const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex')
const json = <T>(v: T | string): T =>
  typeof v === 'string' ? JSON.parse(v) : v
const fail = (message: string): never => {
  throw new ApiError(400, 'INVALID_APP_PUBLICATION', message)
}
const text = (v: unknown, label: string, max: number) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) {
    fail(`${label}无效`)
  }
  return (v as string).trim()
}
export const validVersion = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 48 &&
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/i.test(
    v,
  )
export interface BuildImport {
  sha256: string
  objectUrl: string
  source: { repository: string, commit: string, runId: string }
  credentialId: string
}
export class ApplicationPublishing {
  readonly origin: string
  constructor(
    private readonly source: DataSource,
    private readonly platform: ApplicationPlatform,
    readonly artifacts = new ApplicationArtifacts(),
    origin = process.env.APP_ARTIFACT_ORIGIN || 'http://localhost:6176',
  ) {
    const url = new URL(origin)
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ||
        (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    ) {
      throw new Error(
        'APP_ARTIFACT_ORIGIN must be a separate HTTPS origin in production',
      )
    }
    this.origin = url.origin
  }

  private async audit(
    db: EntityManager,
    appId: string,
    releaseId: string,
    action: string,
    actor: string,
    detail: unknown,
  ) {
    await db.query(
      'INSERT INTO application_publication_events(id,app_id,release_id,action,administrator_id,detail,created_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))',
      [randomUUID(), appId, releaseId, action, actor, JSON.stringify(detail)],
    )
  }

  async readiness(release: AppRelease) {
    if (
      release.backend.type !== 'none' &&
      !this.platform.hasBackend(release.backend.binding)
    ) {
      return { ready: false, reason: '该后端绑定尚未部署，不能发布' }
    }
    if (release.runtime.type === 'shell') {
      const deployed = this.platform.deployedRelease(release.appId)
      if (
        !deployed ||
        deployed.runtime.type !== 'shell' ||
        deployed.manifest.version !== release.manifest.version
      ) {
        return {
          ready: false,
          reason: '此版本页面内置在宿主中，请先部署对应版本的宿主和 API',
        }
      }
      return { ready: true, reason: '随宿主发布的内置页面' }
    }
    const digest = release.runtime.integrity.slice(7)
    if (
      release.runtime.entryUrl !== `${this.origin}/${release.appId}/${digest}/`
    ) {
      return {
        ready: false,
        reason: '应用地址与当前产物服务不一致，请重新选择构建产物',
      }
    }
    try {
      await this.artifacts.verify(release.appId, digest)
      return { ready: true, reason: '构建产物及文件摘要已校验' }
    } catch (e) {
      return {
        ready: false,
        reason: e instanceof Error ? e.message : '构建产物校验失败',
      }
    }
  }

  async list(): Promise<ManagedApplication[]> {
    await this.platform.initialize()
    const applications = await this.source.query(
      'SELECT app_id,kind FROM application_registry ORDER BY created_at,app_id',
    )
    const rows = await this.source.query(
      'SELECT * FROM application_releases ORDER BY created_at DESC,release_id DESC',
    )
    return Promise.all(
      applications.map(
        async (a: { app_id: string, kind: AppRelease['kind'] }) => {
          const releases = await Promise.all(
            rows
              .filter((r: any) => r.app_id === a.app_id)
              .map(async (r: any): Promise<ManagedRelease> => {
                const release = {
                  ...json<AppRelease>(r.definition),
                  kind: a.kind,
                }
                return {
                  release,
                  status: r.status,
                  revision: Number(r.revision),
                  releaseNotes: r.release_notes || '',
                  createdAt: isoTime(r.created_at),
                  submittedAt: r.submitted_at ? isoTime(r.submitted_at) : null,
                  publishedAt: r.published_at ? isoTime(r.published_at) : null,
                  readiness: await this.readiness(release),
                }
              }),
          )
          return {
            appId: a.app_id,
            kind: a.kind,
            currentReleaseId:
              releases.find((r) => r.status === 'published')?.release.releaseId || null,
            releases,
          }
        },
      ),
    )
  }

  async events(appId: string): Promise<ApplicationPublicationEvent[]> {
    if (!validId(appId)) {
      fail('应用标识无效')
    }
    const rows: ApplicationPublicationEvent[] = await this.source.query(
      'SELECT id,app_id AS appId,release_id AS releaseId,action,administrator_id AS administratorId,created_at AS createdAt FROM application_publication_events WHERE app_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
      [appId],
    )
    return rows.map((row) => ({ ...row, createdAt: isoTime(row.createdAt) }))
  }

  /** Draft data never supplies executable server bindings. Existing capability contracts are copied from trusted deployment. */
  async save(input: unknown, actor: string, editingId?: string, build?: BuildImport) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail('版本内容无效')
    }
    const b = input as Record<string, unknown>
    if (
      Object.keys(b).some(
        (k) =>
          ![
            'appId',
            'kind',
            'version',
            'name',
            'description',
            'icon',
            'iconAsset',
            'iconVariant',
            'color',
            'releaseNotes',
            'artifact',
            'runtime',
            'revision',
          ].includes(k),
      )
    ) {
      fail('存在不支持的版本字段')
    }
    if (
      !validId(b.appId) ||
      !validVersion(b.version) ||
      !['system', 'user'].includes(String(b.kind)) ||
      !['shell', 'web'].includes(String(b.runtime))
    ) {
      fail('应用标识、类型或版本无效；版本格式为 1.0.0')
    }
    const appId = b.appId as string
    const name = text(b.name, '应用名称', 80)
    const description = text(b.description, '应用说明', 400)
    if (b.iconAsset !== undefined && b.iconAsset !== '' && !validApplicationIcon(b.iconAsset)) {
      fail('图标需为 PNG、JPEG、WebP、GIF 或静态 SVG，最大 128 KB')
    }
    if (b.iconVariant !== undefined && !['image', 'calendar', 'clock'].includes(String(b.iconVariant))) {
      fail('图标显示方式无效')
    }
    const icon = text(b.icon || 'apps', '图标', 40)
    const color = text(b.color || 'blue', '图标颜色', 30)
    if (
      !/^[\w-]+$/.test(icon) ||
      ![
        'blue',
        'green',
        'violet',
        'orange',
        'rose',
        'amber',
        'cyan',
        'teal',
      ].includes(color)
    ) {
      fail('图标或颜色无效')
    }
    const notes =
      typeof b.releaseNotes === 'string' && b.releaseNotes.length <= 4000
        ? b.releaseNotes.trim()
        : fail('更新说明最多 4000 个字符')
    if (b.runtime === 'web') {
      await this.artifacts.verify(appId, String(b.artifact || ''))
    }
    return this.source.transaction(async (db) => {
      // Match seeding's exclusive registry lock; avoid a shared-to-exclusive upgrade.
      await db.query(
        'INSERT INTO application_registry(app_id,kind,created_at) VALUES(?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE app_id=app_id',
        [appId, b.kind],
      )
      const [application] = await db.query(
        'SELECT kind FROM application_registry WHERE app_id=? FOR UPDATE',
        [appId],
      )
      if (application.kind !== b.kind) {
        fail('应用类型已固定，不能通过更新版本改变系统应用的卸载规则')
      }
      if (build) {
        const [previous] = await db.query(
          'SELECT i.bundle_sha256,r.release_id,r.revision,r.status FROM application_build_imports i JOIN application_releases r ON r.release_id=i.release_id WHERE i.app_id=? AND i.version=?',
          [appId, b.version],
        )
        if (previous) {
          if (previous.bundle_sha256 !== build.sha256) {
            throw new ApiError(409, 'APP_BUILD_CONFLICT', '此版本已经提交其他构建，请使用新的版本号')
          }
          return { releaseId: previous.release_id as string, revision: Number(previous.revision), status: previous.status as string }
        }
      }
      const all = await db.query(
        'SELECT * FROM application_releases WHERE app_id=? ORDER BY published DESC,created_at DESC',
        [appId],
      )
      const old = editingId
        ? all.find((r: any) => r.release_id === editingId)
        : null
      if (editingId && !old) {
        throw new ApiError(404, 'APP_RELEASE_NOT_FOUND', '版本不存在')
      }
      if (
        old &&
        (old.status !== 'draft' || Number(old.revision) !== b.revision)
      ) {
        throw new ApiError(
          409,
          'APP_DRAFT_CHANGED',
          '草稿已修改或已提交，请刷新',
        )
      }
      if (
        all.some(
          (r: any) =>
            r.release_id !== editingId &&
            json<AppRelease>(r.definition).manifest.version === b.version,
        )
      ) {
        throw new ApiError(
          409,
          'APP_VERSION_EXISTS',
          '此应用已存在该版本，请使用新的版本号',
        )
      }
      const base = all[0] ? json<AppRelease>(all[0].definition) : undefined
      if (
        b.runtime === 'shell' &&
        (!this.platform.deployedRelease(appId) ||
          base?.runtime.type !== 'shell')
      ) {
        fail('只有已经部署的宿主应用才能选择内置页面')
      }
      if (base?.runtime.type === 'shell' && b.runtime !== 'shell') {
        fail('此应用的资源与交互协议尚未迁移，暂不能切换为独立 Web 页面')
      }
      const releaseId = editingId || `${appId.slice(0, 32)}-${randomUUID()}`
      const release: AppRelease = {
        appId,
        releaseId,
        protocol: 1,
        kind: application.kind,
        manifest: {
          id: appId,
          name,
          description,
          icon,
          ...(b.iconAsset ? { iconAsset: b.iconAsset as string } : {}),
          ...(b.iconVariant ? { iconVariant: b.iconVariant as 'image' | 'calendar' | 'clock' } : {}),
          color,
          version: b.version as string,
          skillIds: base?.manifest.skillIds || [],
        },
        platforms: base?.platforms || ['web', 'android', 'ios'],
        runtime:
          b.runtime === 'shell'
            ? { type: 'shell' }
            : {
                type: 'web',
                entryUrl: `${this.origin}/${appId}/${b.artifact}/`,
                integrity: `sha256-${b.artifact}`,
              },
        backend: base?.backend || { type: 'none', binding: '' },
        permissions: base?.permissions || [],
        clientTools: base?.clientTools || [],
        defaultInstalled: base?.defaultInstalled ?? false,
      }
      validateRelease(release)
      if (build) {
        const readiness = await this.readiness(release)
        if (!readiness.ready) {
          fail(readiness.reason)
        }
      }
      if (old) {
        await db.query(
          'UPDATE application_releases SET definition=?,definition_hash=?,release_notes=?,revision=revision+1 WHERE release_id=?',
          [JSON.stringify(release), hash(release), notes, releaseId],
        )
      } else {
        await db.query(
          'INSERT INTO application_releases(release_id,app_id,definition,definition_hash,published,status,release_notes,created_at) VALUES(?,?,?,?,0,\'draft\',?,UTC_TIMESTAMP(3))',
          [releaseId, appId, JSON.stringify(release), hash(release), notes],
        )
      }
      await this.audit(
        db,
        appId,
        releaseId,
        old ? 'edit_draft' : 'create_draft',
        actor,
        { version: b.version, definitionHash: hash(release) },
      )
      if (build) {
        await db.query(
          'INSERT INTO application_build_imports(app_id,version,release_id,bundle_sha256,object_url,source,credential_id) VALUES(?,?,?,?,?,?,?)',
          [appId, b.version, releaseId, build.sha256, build.objectUrl, JSON.stringify(build.source), build.credentialId],
        )
        await db.query(
          'UPDATE application_releases SET status=\'submitted\',submitted_by=?,submitted_at=UTC_TIMESTAMP(3) WHERE release_id=?',
          [actor, releaseId],
        )
        await this.audit(db, appId, releaseId, 'submit', actor, { ...build, origin: 'github_actions' })
      }
      return { releaseId, revision: old ? Number(old.revision) + 1 : 1, status: build ? 'submitted' : 'draft' }
    })
  }

  async transition(id: string, input: unknown, actor: string) {
    const b = input as {
      action?: string
      revision?: number
      expectedCurrentReleaseId?: string | null
    }
    if (
      !b ||
      Object.keys(b).some(
        (k) => !['action', 'revision', 'expectedCurrentReleaseId'].includes(k),
      ) ||
      !['submit', 'publish'].includes(b.action || '') ||
      !Number.isSafeInteger(b.revision) ||
      !Object.hasOwn(b, 'expectedCurrentReleaseId') ||
      (b.expectedCurrentReleaseId !== null &&
        typeof b.expectedCurrentReleaseId !== 'string')
    ) {
      fail('发布操作参数无效')
    }
    const result = await this.source.transaction(async (db) => {
      const [ref] = await db.query(
        'SELECT app_id FROM application_releases WHERE release_id=?',
        [id],
      )
      if (!ref) {
        throw new ApiError(404, 'APP_RELEASE_NOT_FOUND', '版本不存在')
      }
      await db.query(
        'SELECT app_id FROM application_registry WHERE app_id=? FOR UPDATE',
        [ref.app_id],
      )
      const [row] = await db.query(
        'SELECT * FROM application_releases WHERE release_id=? FOR UPDATE',
        [id],
      )
      if (Number(row.revision) !== b.revision) {
        throw new ApiError(
          409,
          'APP_RELEASE_CHANGED',
          '版本状态已改变，请刷新',
        )
      }
      const release = json<AppRelease>(row.definition)
      if (b.action === 'submit') {
        if (row.status !== 'draft') {
          throw new ApiError(409, 'APP_RELEASE_LOCKED', '只有草稿可以提交')
        }
        const readiness = await this.readiness(release)
        if (!readiness.ready) {
          fail(readiness.reason)
        }
        await db.query(
          'UPDATE application_releases SET status=\'submitted\',submitted_by=?,submitted_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE release_id=?',
          [actor, id],
        )
      } else {
        if (!['submitted', 'retired'].includes(row.status)) {
          throw new ApiError(
            409,
            'APP_RELEASE_NOT_SUBMITTED',
            '请先提交版本，再发布',
          )
        }
        const [current] = await db.query(
          'SELECT release_id FROM application_releases WHERE app_id=? AND published=1',
          [ref.app_id],
        )
        if ((current?.release_id || null) !== b.expectedCurrentReleaseId) {
          throw new ApiError(
            409,
            'APP_PUBLICATION_CHANGED',
            '线上版本已改变，请刷新后再确认发布',
          )
        }
        const readiness = await this.readiness(release)
        if (!readiness.ready) {
          fail(readiness.reason)
        }
        await db.query(
          'UPDATE application_releases SET published=0,status=\'retired\',revision=revision+1 WHERE app_id=? AND published=1',
          [ref.app_id],
        )
        await db.query(
          'UPDATE application_releases SET published=1,status=\'published\',published_by=?,published_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE release_id=?',
          [actor, id],
        )
      }
      await this.audit(db, ref.app_id, id, b.action!, actor, {
        version: release.manifest.version,
        previous: b.expectedCurrentReleaseId,
      })
      return { releaseId: id }
    })
    if (b.action === 'publish') {
      this.platform.invalidateCatalog()
    }
    return result
  }
}
