import type { DataSource } from 'typeorm'
import type { ApplicationPublishing, BuildImport } from './publishing.js'
import { createHash } from 'node:crypto'
import { validId } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { validVersion } from './publishing.js'

export const bundleLimit = 30 * 1024 * 1024
export const bundleHash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const invalid = (message: string): never => {
  throw new ApiError(400, 'INVALID_APP_BUILD', message)
}
export interface ImportCredential {
  id: string
  administratorId: string
  apps: string[]
}

/** Exact bucket origin and object prefix; caller cannot supply arbitrary fetch destinations. */
export function importLocation(input: unknown, appId: string, version: string, digest: string, origin: string, prefix: string) {
  let url: URL
  try {
    url = new URL(String(input))
  } catch {
    return invalid('OSS 下载地址无效')
  }
  let trusted: URL
  try {
    trusted = new URL(origin)
  } catch {
    throw new ApiError(503, 'APP_IMPORT_NOT_CONFIGURED', '服务器 OSS 桶地址配置无效')
  }
  if (
    trusted.protocol !== 'https:' || trusted.origin !== origin ||
    !/^[a-z0-9][a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(trusted.hostname) ||
    !/^[\w-]+(?:\/[\w-]+)*$/.test(prefix)
  ) {
    throw new ApiError(503, 'APP_IMPORT_NOT_CONFIGURED', '服务器尚未配置受信任的 OSS 桶与目录')
  }
  if (
    url.origin !== origin || url.username || url.password || url.hash ||
    url.pathname !== `/${prefix}/${appId}/${version}/${digest}.json`
  ) {
    invalid('仅允许导入指定 OSS 桶与应用版本目录中的构建')
  }
  return url
}

export async function downloadBundle(url: URL, expectedHash: string, fetcher: typeof fetch = fetch) {
  // No redirects; optional URL credentials are never logged or persisted. Bound transfer size and duration.
  let response: Response
  const signal = AbortSignal.timeout(60_000)
  try {
    response = await fetcher(url, { redirect: 'error', signal })
    if (!response.ok || !response.body) {
      throw new Error('download')
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        size += value.length
        if (size > bundleLimit) {
          throw new Error('size')
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const data = Buffer.concat(chunks)
    if (bundleHash(data) !== expectedHash) {
      invalid('OSS 构建文件 SHA-256 校验失败')
    }
    try {
      return JSON.parse(data.toString('utf8')) as Record<string, unknown>
    } catch {
      return invalid('OSS 构建文件不是有效 JSON')
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(502, 'APP_BUILD_DOWNLOAD_FAILED', 'OSS 下载失败、对象不可读或构建超过 30 MB；请检查发布配置后重新提交')
  }
}

export class ApplicationBuildImports {
  constructor(
    private readonly source: DataSource,
    private readonly publishing: ApplicationPublishing,
    private readonly origin = process.env.APP_IMPORT_OSS_ORIGIN || '',
    private readonly prefix = process.env.APP_IMPORT_OSS_PREFIX || 'builds',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async authenticate(header: unknown): Promise<ImportCredential> {
    const match = typeof header === 'string' ? /^Bearer (tbox_build_[\w-]{43})$/.exec(header) : null
    if (!match) {
      throw new ApiError(401, 'APP_IMPORT_UNAUTHORIZED', '应用构建导入凭证无效')
    }
    const [row] = await this.source.query(
      'SELECT c.id,c.administrator_id,c.apps FROM application_import_credentials c JOIN admin_users a ON a.id=c.administrator_id WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>UTC_TIMESTAMP(3) AND a.enabled=1',
      [bundleHash(match[1]!)],
    )
    if (!row) {
      throw new ApiError(401, 'APP_IMPORT_UNAUTHORIZED', '应用构建导入凭证无效或已过期')
    }
    return {
      id: row.id,
      administratorId: row.administrator_id,
      apps: typeof row.apps === 'string' ? JSON.parse(row.apps) : row.apps,
    }
  }

  async submit(input: unknown, actor: ImportCredential) {
    const b = input as Record<string, unknown>
    if (
      !b || Array.isArray(b) || typeof b !== 'object' ||
      Object.keys(b).some((k) => !['appId', 'version', 'url', 'sha256', 'source'].includes(k)) ||
      !validId(b.appId) || !validVersion(b.version) ||
      typeof b.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(b.sha256)
    ) {
      invalid('应用构建提交参数无效')
    }
    const appId = b.appId as string
    const version = b.version as string
    const sha256 = b.sha256 as string
    if (!actor.apps.includes(appId)) {
      throw new ApiError(403, 'APP_IMPORT_FORBIDDEN', '此凭证无权提交该应用')
    }
    const source = b.source as BuildImport['source']
    if (!source || Object.keys(source).some((k) => !['repository', 'commit', 'runId'].includes(k)) ||
      typeof source.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(source.repository) || source.repository.length > 200 ||
      typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/.test(source.commit) ||
      typeof source.runId !== 'string' || !/^\d{1,30}$/.test(source.runId)) {
      invalid('GitHub 构建来源无效')
    }
    if (!this.origin) {
      throw new ApiError(503, 'APP_IMPORT_NOT_CONFIGURED', '服务器尚未配置 OSS 构建导入')
    }
    const url = importLocation(b.url, appId, version, sha256, this.origin, this.prefix)
    const bundle = await downloadBundle(url, sha256, this.fetcher)
    if (!bundle || Array.isArray(bundle) || bundle.protocol !== 1 || bundle.appId !== appId || bundle.version !== version ||
      Object.keys(bundle).some((k) => !['protocol', 'appId', 'version', 'artifact', 'files', 'publication', 'releaseNotes'].includes(k))) {
      invalid('构建内容与提交的应用、版本不一致')
    }
    const publication = bundle.publication as Record<string, unknown>
    if (!publication || typeof publication !== 'object' || Array.isArray(publication) ||
      Object.keys(publication).some((k) => !['kind', 'name', 'description', 'icon', 'iconAsset', 'iconVariant', 'color', 'updatePrompt'].includes(k))) {
      invalid('构建发布声明无效')
    }
    const artifact = await this.publishing.artifacts.upload(appId, { files: bundle.files })
    if (artifact.digest !== bundle.artifact) {
      invalid('构建产物摘要不一致')
    }
    return this.publishing.save({
      ...publication,
      appId,
      version,
      artifact: artifact.digest,
      runtime: 'web',
      releaseNotes: bundle.releaseNotes,
    }, actor.administratorId, undefined, {
      sha256,
      objectUrl: url.origin + url.pathname,
      source,
      credentialId: actor.id,
    })
  }
}
