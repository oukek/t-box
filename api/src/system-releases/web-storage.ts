import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import OSS from 'ali-oss'
import { resourceStorageSettings } from '../config.js'
import { ErrorCode } from '../error-codes.js'

export interface WebStorage {
  read(key: string): Promise<Buffer>
  write(path: string, content: Buffer): Promise<void>
}
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
}
export function webStorage(): WebStorage {
  const options = resourceStorageSettings()
  if (!options) {
    throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('请配置主站 OSS 访问凭证')
  }
  const client = new OSS({ ...options, bucket: process.env.WEB_OSS_BUCKET || 'tboxos', region: 'oss-' + options.region, secure: true, authorizationV4: true, timeout: 30000 })
  return {
    async read(key) {
      const meta = await client.head(key).catch(() => {
        throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('无法读取主站 OSS 候选包')
      })
      const length = Number((meta.res.headers as Record<string, unknown>)['content-length'])
      if (!Number.isSafeInteger(length) || length < 1 || length > 30 * 1024 * 1024) {
        throw ErrorCode.INVALID_APP_BUILD('候选包大小无效')
      }
      const object = await client.get(key).catch(() => {
        throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('下载候选包失败，请重试')
      })
      return Buffer.from(object.content)
    },
    async write(path, content) {
      const stem = path.slice(0, path.length - extname(path).length)
      const hashed = path.startsWith('assets/') && stem.includes('-') && /^[\w-]{8,}$/.test(stem.slice(stem.lastIndexOf('-') + 1))
      await client.put(path, content, {
        mime: path === '.well-known/apple-app-site-association' ? 'application/json' : types[extname(path)] || 'application/octet-stream',
        headers: {
          'Content-MD5': createHash('md5').update(content).digest('base64'),
          'Cache-Control': hashed ? 'public,max-age=31536000,immutable' : 'no-cache',
          'x-oss-object-acl': 'public-read',
        },
      })
      const url = new URL('https://' + (process.env.WEB_OSS_BUCKET || 'tboxos') + '.oss-' + options.region + '.aliyuncs.com/' + path)
      url.searchParams.set('tbox_sha256', createHash('sha256').update(content).digest('hex'))
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
      if (!response.ok || !content.equals(Buffer.from(await response.arrayBuffer()))) {
        throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('主站 OSS 公开读取校验失败')
      }
    },
  }
}

export async function readCandidate(storage: WebStorage, build: string, digest: string, version: string) {
  const bytes = await storage.read('system-candidates/' + build + '/' + digest + '.json')
  if (createHash('sha256').update(bytes).digest('hex') !== digest) {
    throw ErrorCode.INVALID_APP_BUILD('候选包摘要不匹配')
  }
  const files = new Map<string, Buffer>()
  let total = 0
  try {
    const entries = JSON.parse(bytes.toString())
    if (!Array.isArray(entries) || entries.length > 2000) {
      throw ErrorCode.INVALID_APP_BUILD()
    }
    for (const { path, content } of entries) {
      if (typeof path !== 'string' || typeof content !== 'string' || path.length > 240 || files.has(path) ||
        !/^(?:(?:assets|promotion|wallpapers)\/[\w./@-]+|\.well-known\/apple-app-site-association|[\w-]+\.(?:html|js|json|svg|png|webmanifest|ico|txt))$/.test(path) ||
        path.split('/').some((part) => !part || part === '.' || part === '..' || (part.startsWith('.') && part !== '.well-known'))) {
        throw ErrorCode.INVALID_APP_BUILD()
      }
      const file = Buffer.from(content, 'base64')
      total += file.length
      if (file.toString('base64') !== content || file.length > 5 * 1024 * 1024 || total > 20 * 1024 * 1024) {
        throw ErrorCode.INVALID_APP_BUILD()
      }
      files.set(path, file)
    }
    const marker = JSON.parse(files.get('web-version.json')!.toString())
    if (marker.build !== build || marker.version !== version || !files.get('index.html')?.length || !files.get('tbox-offline-sw.js')?.length) {
      throw ErrorCode.INVALID_APP_BUILD()
    }
  } catch {
    throw ErrorCode.INVALID_APP_BUILD('候选文件清单或版本标记无效')
  }
  return { files, total }
}
