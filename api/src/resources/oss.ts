import type { ResourceFileMetadata, ResourceStorage } from './storage.js'
import { createHash, randomBytes } from 'node:crypto'
import { parseId } from '@t-box/server-foundation/validation'
import OSS from 'ali-oss'
import { ErrorCode } from '../error-codes.js'

export const RESOURCE_OSS_PREFIX = 'uploads/resources'
export interface OssResourceOptions {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  stsToken?: string
}
/** Scope the persisted backend ID to its immutable physical bucket, independent of key rotation. */
export function ossResourceBackend(
  options: Pick<OssResourceOptions, 'region' | 'bucket'>,
) {
  return `oss-${createHash('sha256').update(`${options.region}/${options.bucket}`).digest('hex').slice(0, 24)}`
}
export class OssResourceStorage implements ResourceStorage {
  readonly origin: string | undefined
  readonly prefix: string
  readonly client: Pick<OSS, 'put' | 'get' | 'delete'>
  constructor(
    options: OssResourceOptions & { private?: boolean },
    client?: OssResourceStorage['client'],
  ) {
    this.origin = options.private ? undefined : `https://${options.bucket}.oss-${options.region}.aliyuncs.com`
    this.prefix = options.private ? `${RESOURCE_OSS_PREFIX}/application-files` : RESOURCE_OSS_PREFIX
    const configuration = {
      ...options,
      region: `oss-${options.region}`,
      secure: true,
      authorizationV4: true,
      timeout: 30000,
      retryMax: 0,
    }
    this.client = client ?? new OSS(configuration)
  }

  path(id: string) {
    parseId(id)
    // Independent random object names reveal neither the resource ID nor the original filename.
    return `${this.prefix}/${randomBytes(32).toString('hex')}`
  }

  private key(path: string) {
    const id = path.slice(this.prefix.length + 1)
    if (!path.startsWith(this.prefix + '/') ||
      (!/^[a-f0-9]{64}$/.test(id) && path !== `${this.prefix}/${parseId(id)}`)) {
      throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE()
    }
    return path
  }

  async write(
    path: string,
    bytes: Buffer,
    file: ResourceFileMetadata = {
      name: 'file',
      mimeType: 'application/octet-stream',
    },
  ) {
    const key = this.key(path)
    const image = ['image/png', 'image/jpeg', 'image/webp'].includes(
      file.mimeType,
    )
    try {
      await this.client.put(key, bytes, {
        mime: image ? file.mimeType : 'application/octet-stream',
        headers: {
          'x-oss-object-acl': this.origin ? 'public-read' : 'private',
          'x-oss-forbid-overwrite': 'true',
          'Content-MD5': createHash('md5').update(bytes).digest('base64'),
          'Cache-Control': 'no-store',
          'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        },
      })
    } catch {
      // SDK errors can contain signed requests and credentials; never expose or log them.
      throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE(
        '文件上传失败，请检查 OSS 配置后重试',
      )
    }
  }

  async read(path: string) {
    const key = this.key(path)
    try {
      const result = await this.client.get(key)
      return Buffer.from(result.content)
    } catch (error) {
      if ((error as { code?: string }).code === 'NoSuchKey') {
        throw ErrorCode.RESOURCE_MISSING()
      }
      throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('文件存储暂时不可用')
    }
  }

  async remove(path: string) {
    const key = this.key(path)
    try {
      await this.client.delete(key)
    } catch (error) {
      if ((error as { code?: string }).code !== 'NoSuchKey') {
        throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE('文件清理暂时失败')
      }
    }
  }
}
