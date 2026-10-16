import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true })

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
    adminOrigins: (process.env.ADMIN_ORIGINS ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5175,http://127.0.0.1:5175'))
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        const url = new URL(origin)
        if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) ||
          (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
          throw new Error('ADMIN_ORIGINS 必须是完整的 HTTPS 后台来源，不包含路径或通配符')
        }
        return origin
      }),
    trustedProxies: (process.env.TRUSTED_PROXIES ?? '')
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
    corsOrigins: (
      process.env.CORS_ORIGINS ??
      'http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,http://localhost,https://localhost'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
}
