import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'
import { lookup } from 'node:dns/promises'
import { get } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { ApiError } from '@t-box/server-foundation/errors'
import { detectMime, MAX_RESOURCE_SIZE } from './service.js'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4')
}
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('2001::', 32, 'ipv6')
export function publicImageAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 &&
      globalV6.check(address, 'ipv6') &&
      !blocked.check(address, 'ipv6')
}
export function imageDownloadUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError(502, 'IMAGE_URL_INVALID', '服务商返回的图片地址无效')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new ApiError(
      502,
      'IMAGE_URL_INVALID',
      '图片下载地址必须使用无账号的标准 HTTPS 地址',
    )
  }
  return url
}
type Download = (url: string, signal: AbortSignal) => Promise<Buffer>
/** Resolve and pin a public destination on every hop; never forward the provider's API key. */
export const downloadImage: Download = async (value, signal) => {
  let url = imageDownloadUrl(value)
  const limitedSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  try {
    for (let hop = 0; hop <= 3; hop++) {
      limitedSignal.throwIfAborted()
      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookup(hostname, { all: true })
      if (
        !addresses.length ||
        addresses.some((a) => !publicImageAddress(a.address))
      ) {
        throw new ApiError(
          502,
          'IMAGE_URL_BLOCKED',
          '服务商图片地址指向非公网网络，已拒绝下载',
        )
      }
      const address = addresses.find((a) => a.family === 4) || addresses[0]!
      const pinnedLookup: LookupFunction = (_host, options, callback) => {
        if (typeof options === 'object' && options.all) {
          callback(null, [address])
        } else {
          callback(null, address.address, address.family)
        }
      }
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const request = get(
          url,
          {
            lookup: pinnedLookup,
            agent: false,
            signal: limitedSignal,
            headers: { Accept: 'image/*' },
          },
          resolve,
        )
        request.once('error', reject)
      })
      const status = response.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy()
        if (!response.headers.location || hop === 3) {
          throw new ApiError(
            502,
            'IMAGE_DOWNLOAD_REDIRECT',
            '图片下载重定向次数过多或地址缺失',
          )
        }
        url = imageDownloadUrl(new URL(response.headers.location, url).href)
        continue
      }
      if (status !== 200) {
        response.destroy()
        throw new ApiError(
          502,
          'IMAGE_DOWNLOAD_FAILED',
          status === 401 || status === 403
            ? '图片下载需要额外鉴权，请服务商返回 base64 或公开的临时图片地址'
            : `服务商图片下载失败（HTTP ${status}）`,
        )
      }
      if (Number(response.headers['content-length']) > MAX_RESOURCE_SIZE) {
        response.destroy()
        throw new ApiError(
          502,
          'IMAGE_OUTPUT_TOO_LARGE',
          '生成图片超过 10 MB，无法保存',
        )
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response) {
        size += chunk.length
        if (size > MAX_RESOURCE_SIZE) {
          response.destroy()
          throw new ApiError(
            502,
            'IMAGE_OUTPUT_TOO_LARGE',
            '生成图片超过 10 MB，无法保存',
          )
        }
        chunks.push(Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    }
    throw new ApiError(
      502,
      'IMAGE_DOWNLOAD_REDIRECT',
      '图片下载重定向次数过多',
    )
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(
      502,
      limitedSignal.aborted
        ? 'IMAGE_DOWNLOAD_TIMEOUT'
        : 'IMAGE_DOWNLOAD_FAILED',
      limitedSignal.aborted
        ? '图片下载超时，生成结果需要核对'
        : '无法下载服务商生成的图片，请检查图片地址是否可访问',
    )
  }
}

export async function imageOutput(
  value: { b64_json?: string, url?: string } | undefined,
  signal: AbortSignal,
  download: Download = downloadImage,
) {
  let bytes: Buffer
  if (typeof value?.b64_json === 'string' && value.b64_json) {
    const data = value.b64_json
      .trim()
      .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    if (
      data.length > Math.ceil(MAX_RESOURCE_SIZE / 3) * 4 ||
      !/^[A-Z0-9+/]+={0,2}$/i.test(data)
    ) {
      throw new ApiError(
        502,
        'IMAGE_OUTPUT_INVALID',
        '图片 base64 数据无效或超过 10 MB',
      )
    }
    bytes = Buffer.from(data, 'base64')
  } else if (typeof value?.url === 'string' && value.url) {
    imageDownloadUrl(value.url)
    bytes = await download(value.url, signal)
  } else {
    throw new ApiError(
      502,
      'IMAGE_OUTPUT_INVALID',
      '服务商没有返回图片数据或图片地址',
    )
  }
  if (!bytes.length || bytes.length > MAX_RESOURCE_SIZE) {
    throw new ApiError(
      502,
      'IMAGE_OUTPUT_INVALID',
      '服务商返回空图片或图片超过 10 MB',
    )
  }
  let mime: string
  try {
    mime = detectMime(bytes)
  } catch {
    throw new ApiError(502, 'IMAGE_OUTPUT_INVALID', '服务商未返回有效图片')
  }
  if (!mime.startsWith('image/')) {
    throw new ApiError(502, 'IMAGE_OUTPUT_INVALID', '服务商未返回有效图片')
  }
  return { bytes, mime }
}
