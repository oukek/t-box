import type { ResourceFileMetadata, ResourceStorage } from './storage.js'
import { createHash } from 'node:crypto'
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
  readonly origin: string
  readonly client: Pick<OSS, 'put' | 'get' | 'delete'>
  constructor(
    options: OssResourceOptions,
    client?: OssResourceStorage['client'],
  ) {
    this.origin = `https://${options.bucket}.oss-${options.region}.aliyuncs.com`
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
    return `${RESOURCE_OSS_PREFIX}/${parseId(id)}`
  }

  private key(path: string) {
    const id = path.slice(RESOURCE_OSS_PREFIX.length + 1)
    if (path !== this.path(id)) {
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
          'x-oss-object-acl': 'public-read',
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
