import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import OSS from 'ali-oss'
import { ossTransferError } from './diagnostics.mjs'

/** Pass only SDK settings, never the deployment process's other credentials. */
export function ossClientOptions(bucket, env = process.env, { allowInternal = false } = {}) {
  const region = env.OSS_REGION || ''
  const endpoint = env.OSS_ENDPOINT || `https://oss-${region}.aliyuncs.com`
  const endpoints = [`https://oss-${region}.aliyuncs.com`]
  if (allowInternal) {
    endpoints.push(`https://oss-${region}-internal.aliyuncs.com`)
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '') ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) || region.startsWith('oss-') || region.endsWith('-internal') || !endpoints.includes(endpoint)) {
    throw new Error('Configure an OSS bucket, OSS_REGION and a matching public OSS_ENDPOINT (or same-region internal endpoint for server transfers)')
  }
  if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) {
    throw new Error('Configure OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET')
  }
  for (const name of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_SESSION_TOKEN']) {
    if (typeof env[name] === 'string' && env[name] !== env[name].trim()) {
      throw new Error(`${name} contains leading/trailing whitespace; re-enter the credential without spaces or line breaks`)
    }
  }
  return {
    region: `oss-${region}`,
    bucket,
    endpoint,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    stsToken: env.OSS_SESSION_TOKEN || undefined,
    secure: true,
    authorizationV4: true,
    timeout: 180_000,
    retryMax: 4,
  }
}

export function createOssClient(options) {
  return new OSS(options)
}

function validateKey(key) {
  if (typeof key !== 'string' || key.length > 1024 || !/^[\w./@-]+$/.test(key) || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid OSS object key')
  }
}

/** Static buffers use PutObject; large archives use bounded multipart uploads and SDK part retries. */
export async function putOssObject(client, key, input, options = {}) {
  validateKey(key)
  let checkpoint
  try {
    const size = Buffer.isBuffer(input) ? input.length : (await stat(input)).size
    if (size >= 16 * 1024 * 1024 && !Buffer.isBuffer(input)) {
      await client.multipartUpload(key, input, {
        ...options,
        partSize: 8 * 1024 * 1024,
        parallel: 3,
        progress: (_percentage, current) => {
          checkpoint = current
        },
      })
    } else {
      const hash = createHash('md5')
      if (Buffer.isBuffer(input)) {
        hash.update(input)
      } else {
        for await (const chunk of createReadStream(input)) {
          hash.update(chunk)
        }
      }
      await client.put(key, input, { ...options, headers: { ...options.headers, 'Content-MD5': hash.digest('base64') } })
    }
  } catch (error) {
    if (checkpoint?.uploadId) {
      await client.abortMultipartUpload(key, checkpoint.uploadId).catch(() => {})
    }
    throw ossTransferError('upload', error, client, key)
  }
}

/** Download archives with bounded streaming memory; publish the local filename only after success. */
export async function downloadOssObject(client, key, destination, limit) {
  validateKey(key)
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('An exact download size limit is required')
  }
  const temporary = `${destination}.${randomUUID()}.partial`
  let stream
  try {
    const result = await client.getStream(key)
    stream = result.stream
    if (Number(result.res?.headers?.['content-length']) > limit) {
      throw new Error('OSS download exceeds its size limit')
    }
    let size = 0
    const bounded = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length
        callback(size > limit ? new Error('OSS download exceeds its size limit') : null, chunk)
      },
    })
    await pipeline(stream, bounded, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    await rename(temporary, destination)
  } catch (error) {
    throw ossTransferError('download', error, client, key)
  } finally {
    stream?.destroy()
    await rm(temporary, { force: true })
  }
}
