import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validId } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { applicationSettings } from '../config.js'
import { OssApplicationArtifacts } from './oss-artifacts.js'

export const applicationArtifactRoot = fileURLToPath(
  new URL('../../../output/app-artifacts/', import.meta.url),
)
const sha = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex')
const bad = (message: string): never => {
  throw new ApiError(400, 'INVALID_APP_ARTIFACT', message)
}
const pathValid = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length <= 240 &&
  /^[\w./@-]+$/.test(p) &&
  p.split('/').every((s) => s && s !== '.' && s !== '..') &&
  p !== 'artifact.json'
export interface ArtifactSummary {
  digest: string
  fileCount: number
  bytes: number
}
/** Publisher uploads a static build directory. No archive extraction, shell execution or network fetch. */
export class ApplicationArtifacts {
  readonly remote?: OssApplicationArtifacts
  constructor(readonly root = applicationArtifactRoot, options: { delivery?: string, origin?: string, fetcher?: typeof fetch } = {}) {
    const settings = applicationSettings()
    const delivery = options.delivery || settings.delivery
    if (process.env.NODE_ENV === 'production' && delivery !== 'oss') {
      throw new Error('Production application files must be stored in OSS')
    }
    if (delivery === 'oss') {
      this.remote = new OssApplicationArtifacts(options.origin || settings.origin, options.fetcher)
    }
  }

  async upload(appId: string, input: unknown): Promise<ArtifactSummary> {
    if (!validId(appId)) {
      bad('应用标识无效')
    }
    const body = input as { files?: { path: string, content: string }[] }
    if (
      !body ||
      !Array.isArray(body.files) ||
      Object.keys(body).some((k) => k !== 'files') ||
      !body.files.length ||
      body.files.length > 2000
    ) {
      bad('请选择构建后的 dist 目录，最多 2000 个文件')
    }
    const values = new Map<string, Buffer>()
    let bytes = 0
    for (const file of body.files!) {
      if (
        !file ||
        Object.keys(file).some((k) => !['path', 'content'].includes(k)) ||
        !pathValid(file.path) ||
        values.has(file.path) ||
        typeof file.content !== 'string' ||
        file.content.length > 7 * 1024 * 1024
      ) {
        bad('文件路径、大小或内容无效')
      }
      const value = Buffer.from(file.content, 'base64')
      if (value.toString('base64') !== file.content) {
        bad('文件内容编码无效')
      }
      bytes += value.length
      if (value.length > 5 * 1024 * 1024 || bytes > 20 * 1024 * 1024) {
        bad('单文件最多 5 MB，完整应用最多 20 MB')
      }
      values.set(file.path, value)
    }
    if (!values.has('index.html')) {
      bad('构建目录根部必须包含 index.html')
    }
    const files = Object.fromEntries(
      [...values]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, v]) => [p, sha(v)]),
    )
    const digest = sha(JSON.stringify(files))
    if (this.remote) {
      return this.remote.verify(appId, digest)
    }
    const parent = join(this.root, appId)
    const target = join(parent, digest)
    const temporary = join(parent, `.upload-${randomUUID()}`)
    await mkdir(temporary, { recursive: true })
    try {
      for (const [path, value] of values) {
        const destination = join(temporary, path)
        await mkdir(resolve(destination, '..'), { recursive: true })
        await writeFile(destination, value, { flag: 'wx' })
      }
      await writeFile(
        join(temporary, 'artifact.json'),
        JSON.stringify({ protocol: 1, appId, digest, files }, null, 2) + '\n',
      )
      try {
        await rename(temporary, target)
      } catch (e) {
        if (
          !['EEXIST', 'ENOTEMPTY'].includes(
            (e as NodeJS.ErrnoException).code || '',
          )
        ) {
          throw e
        }
        await this.verify(appId, digest)
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
    return { digest, fileCount: values.size, bytes }
  }

  async verify(appId: string, digest: string): Promise<ArtifactSummary> {
    if (this.remote) {
      return this.remote.verify(appId, digest)
    }
    if (!validId(appId) || !/^[a-f0-9]{64}$/.test(digest)) {
      bad('构建摘要无效')
    }
    const dir = join(this.root, appId, digest)
    let manifest: {
      protocol: number
      appId: string
      digest: string
      files: Record<string, string>
    }
    try {
      manifest = JSON.parse(await readFile(join(dir, 'artifact.json'), 'utf8'))
    } catch {
      bad('构建产物不存在，请先上传 dist 目录')
    }
    if (
      manifest!.protocol !== 1 ||
      manifest!.appId !== appId ||
      manifest!.digest !== digest ||
      !manifest!.files ||
      sha(JSON.stringify(manifest!.files)) !== digest
    ) {
      bad('构建产物清单校验失败')
    }
    let bytes = 0
    const scanned = new Set<string>()
    const scan = async (base: string, prefix = '') => {
      for (const entry of await readdir(base, { withFileTypes: true })) {
        const relative = prefix + entry.name
        if (relative === 'artifact.json') {
          continue
        }
        if (entry.isDirectory()) {
          await scan(join(base, entry.name), relative + '/')
        } else if (entry.isFile() && pathValid(relative)) {
          const value = await readFile(join(base, entry.name))
          if (sha(value) !== manifest!.files[relative]) {
            bad('构建文件摘要不一致')
          }
          bytes += value.length
          scanned.add(relative)
        } else {
          bad('构建目录不能包含链接或特殊文件')
        }
      }
    }
    await scan(dir)
    if (
      !scanned.has('index.html') ||
      scanned.size !== Object.keys(manifest!.files).length
    ) {
      bad('构建产物不完整')
    }
    return { digest, bytes, fileCount: scanned.size }
  }

  async list(appId: string, digests: readonly string[] = []): Promise<ArtifactSummary[]> {
    if (!validId(appId)) {
      bad('应用标识无效')
    }
    if (this.remote) {
      return Promise.all([...new Set(digests)].map((digest) => this.remote!.verify(appId, digest)))
    }
    let entries: string[]
    try {
      entries = await readdir(join(this.root, appId))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw e
    }
    const result = []
    for (const digest of entries.filter((e) => /^[a-f0-9]{64}$/.test(e))) {
      result.push(await this.verify(appId, digest))
    }
    return result
  }
}
