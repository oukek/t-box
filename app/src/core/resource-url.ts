/** Assemble at read time; durable resource metadata contains only the object key. */
export function resourceUrl(origin: string, path: string) {
  if (!/^https:\/\/[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(origin) ||
    !/^uploads\/resources\/[a-f0-9-]{36}$/i.test(path)) {
    throw new Error('文件地址无效')
  }
  return new URL(`/${path}`, origin).href
}
