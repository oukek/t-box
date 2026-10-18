import type { ArtifactSummary } from './artifacts.js'
import { createHash } from 'node:crypto'
import { validId } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { ErrorCode } from '../error-codes.js'

const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')
const validPath = (value: string) =>
  value.length <= 240 &&
  /^[\w./@-]+$/.test(value) &&
  value.split('/').every((part) => part && part !== '.' && part !== '..') &&
  value !== 'artifact.json'
const invalid = (): never => {
  throw ErrorCode.INVALID_APP_ARTIFACT()
}
const verified = new Map<
  string,
  { promise: Promise<ArtifactSummary>, expiresAt: number }
>()
let active = 0
const waiting: (() => void)[] = []
async function bounded<T>(work: () => Promise<T>) {
  if (active < 2) {
    active++
  } else {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) {
      next()
    } else {
      active--
    }
  }
}

/** Public immutable files are checked in bounded memory and are never copied to server storage. */
export class OssApplicationArtifacts {
  constructor(
    readonly origin: string,
    readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(origin)
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw ErrorCode.INTERNAL_OSS_APPLICATIONS_REQUIRE_AN_EXACT_PUBLIC_HTTPS_ORIGIN()
    }
  }

  private async read(url: string, limit: number, signal: AbortSignal) {
    const response = await this.fetcher(url, {
      redirect: 'error',
      cache: 'no-store',
      signal,
    })
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get('content-length')) > limit
    ) {
      invalid()
    }
    const chunks: Buffer[] = []
    let size = 0
    const reader = response.body!.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        size += value.byteLength
        if (size > limit) {
          invalid()
        }
        chunks.push(Buffer.from(value))
      }
      return Buffer.concat(chunks)
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  async verify(appId: string, digest: string): Promise<ArtifactSummary> {
    if (!validId(appId) || !/^[a-f0-9]{64}$/.test(digest)) {
      invalid()
    }
    // Cache only public integrity summaries; file bodies never survive a verification.
    const key = `${this.origin}/${appId}/${digest}`
    const cached = this.fetcher === fetch ? verified.get(key) : undefined
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise
    }
    const promise = bounded(() => this.check(appId, digest))
    if (this.fetcher === fetch) {
      if (verified.size >= 128) {
        verified.delete(verified.keys().next().value!)
      }
      const entry = { promise, expiresAt: Infinity }
      verified.set(key, entry)
      promise.then(
        () => {
          entry.expiresAt = Date.now() + 60000
        },
        () => {
          if (verified.get(key) === entry) {
            verified.delete(key)
          }
        },
      )
    }
    return promise
  }

  private async check(appId: string, digest: string): Promise<ArtifactSummary> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const base = `${this.origin}/${appId}/${digest}/`
      const manifest = JSON.parse(
        (
          await this.read(
            base + 'artifact.json',
            1024 * 1024,
            controller.signal,
          )
        ).toString('utf8'),
      )
      if (
        !manifest ||
        manifest.protocol !== 1 ||
        manifest.appId !== appId ||
        manifest.digest !== digest ||
        !manifest.files ||
        Array.isArray(manifest.files) ||
        typeof manifest.files !== 'object' ||
        hash(JSON.stringify(manifest.files)) !== digest
      ) {
        invalid()
      }
      const files = Object.entries(manifest.files) as [string, unknown][]
      if (
        !files.length ||
        files.length > 2000 ||
        !Object.hasOwn(manifest.files, 'index.html') ||
        files.some(
          ([path, value]) =>
            !validPath(path) ||
            typeof value !== 'string' ||
            !/^[a-f0-9]{64}$/.test(value),
        )
      ) {
        invalid()
      }
      let bytes = 0
      let cursor = 0
      await Promise.all(
        Array.from({ length: Math.min(4, files.length) }, async () => {
          for (;;) {
            const file = files[cursor++]
            if (!file) {
              return
            }
            const value = await this.read(
              base + file[0],
              5 * 1024 * 1024,
              controller.signal,
            )
            bytes += value.length
            if (bytes > 20 * 1024 * 1024 || hash(value) !== file[1]) {
              invalid()
            }
          }
        }),
      )
      return { digest, bytes, fileCount: files.length }
    } catch (error) {
      controller.abort()
      if (error instanceof ApiError) {
        throw error
      }
      throw ErrorCode.APP_ARTIFACT_DOWNLOAD_FAILED()
    } finally {
      clearTimeout(timer)
    }
  }
}
