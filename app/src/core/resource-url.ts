import { ErrorCode } from '../error-codes.js'
/** Assemble at read time; durable resource metadata contains only the object key. */
export function resourceUrl(origin: string, path: string) {
  if (
    !/^https:\/\/[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(origin) ||
    !/^uploads\/resources\/[a-f0-9-]{36}$/i.test(path)
  ) {
    throw ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED()
  }
  return new URL(`/${path}`, origin).href
}
