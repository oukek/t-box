import { existsSync, readFileSync } from 'node:fs'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true })

// Actions records public deployment settings alongside the verified PM2 runtime.
// Local development and the optional Docker layout have no PM2 release metadata.
const releaseFile = new URL('../../release-info.json', import.meta.url)
const release: {
  format?: string
  artifactOrigin?: string
  artifactDelivery?: string
  artifactImportOrigin?: string
  artifactImportPrefix?: string
  resourceRegion?: string
  resourceBucket?: string
} = existsSync(releaseFile) ? JSON.parse(readFileSync(releaseFile, 'utf8')) : {}
if (existsSync(releaseFile) && release.format !== 'tbox-pm2-v1') {
  throw new Error('Invalid PM2 release configuration')
}

export function applicationSettings() {
  return {
    origin: process.env.APP_ARTIFACT_ORIGIN || release.artifactOrigin || 'http://localhost:6176',
    delivery: process.env.APP_ARTIFACT_DELIVERY || release.artifactDelivery || (process.env.NODE_ENV === 'production' ? 'oss' : 'local'),
    importOrigin: process.env.APP_IMPORT_OSS_ORIGIN ?? release.artifactImportOrigin ?? '',
    importPrefix: process.env.APP_IMPORT_OSS_PREFIX || release.artifactImportPrefix || 'builds',
  }
}

/** Build-time configuration contains only immutable bootstrap digests, never application files. */
export function applicationBootstrapArtifacts(): Record<string, string> {
  const file = new URL('../bootstrap-applications.json', import.meta.url)
  if (!existsSync(file)) {
    return {}
  }
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.entries(value).some(([appId, digest]) => !/^[a-z][a-z0-9_-]{0,63}$/.test(appId) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error('Invalid application bootstrap metadata')
  }
  return value
}

/** Server-only upload credentials; public bucket/region may be supplied by the release. */
export function resourceStorageSettings() {
  if (process.env.NODE_ENV === 'production' && applicationSettings().delivery !== 'oss') {
    throw new Error('生产环境必须使用 OSS 应用交付，不能在服务器持久保存应用文件')
  }
  const region = (process.env.OSS_REGION || release.resourceRegion || '').replace(/^oss-/, '')
  const bucket = process.env.OSS_RESOURCE_BUCKET || release.resourceBucket || 'tboxos'
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || ''
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || ''
  const stsToken = process.env.OSS_SESSION_TOKEN || undefined
  if (!accessKeyId && !accessKeySecret && !region && process.env.NODE_ENV !== 'production') {
    return undefined
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !accessKeySecret) {
    throw new Error('业务文件 OSS 配置不完整：请设置 OSS_REGION、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET（Bucket 默认 tboxos）')
  }
  return { region, bucket, accessKeyId, accessKeySecret, stsToken }
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  max = 65_535,
): number {
  if (value === undefined || value === '') {
    return fallback
  }
  if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > max) {
    throw new Error(`${name} 配置无效`)
  }
  return Number(value)
}

function address(
  value: string,
  defaultPort: number,
  name: string,
): { host: string, port: number } {
  try {
    const parsed = new URL(`tcp://${value}`)
    if (
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname && parsed.pathname !== '/')
    ) {
      throw new Error('invalid address')
    }
    return {
      host: parsed.hostname.replace(/^\[|\]$/g, ''),
      port: integer(parsed.port || undefined, defaultPort, name),
    }
  } catch {
    throw new Error(`${name} 应为 host:port`)
  }
}

export function getConfig() {
  const database = process.env.MYSQL_DATABASE ?? 't_box'
  if (!/^\w+$/.test(database)) {
    throw new Error('MYSQL_DATABASE 只能包含字母、数字和下划线')
  }
  const mysqlAddress = address(
    process.env.MYSQL_HOST ?? '127.0.0.1:3306',
    3306,
    'MYSQL_HOST',
  )
  const redisAddress = process.env.REDIS_ADDR
    ? address(process.env.REDIS_ADDR, 6379, 'REDIS_ADDR')
    : undefined
  return {
    adminOrigins: (process.env.ADMIN_ORIGINS ?? '*')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        if (origin === '*') {
          return origin
        }
        const url = new URL(origin)
        if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) ||
          (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
          throw new Error('ADMIN_ORIGINS 必须是完整的 HTTPS 后台来源，不包含路径或通配符')
        }
        return origin
      }),
    trustedProxies: (process.env.TRUSTED_PROXIES ?? '127.0.0.1,::1')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    host: process.env.HOST ?? '127.0.0.1',
    port: integer(process.env.PORT, 3000, 'PORT'),
    mysql: {
      ...mysqlAddress,
      user: process.env.MYSQL_USERNAME ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database,
      timezone: 'Z',
      dateStrings: true,
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 3_000,
    },
    redis: redisAddress
      ? {
          socket: {
            host: redisAddress.host,
            port: redisAddress.port,
            connectTimeout: 2_000,
          },
          password: process.env.REDIS_PASSWORD || undefined,
          database: integer(process.env.REDIS_DB, 0, 'REDIS_DB', 15),
        }
      : undefined,
    corsOrigins: (process.env.CORS_ORIGINS ?? '*')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
}
