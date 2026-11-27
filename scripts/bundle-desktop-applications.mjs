// Pin the same published, content-addressed bytes that the market installs.
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function read(url, limit) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok) {
    throw new Error('无法获取已发布的应用资源 ' + url)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > limit) {
    throw new Error('应用资源过大')
  }
  return bytes
}
export async function bundleDesktopApplications(directory, origin, releases, guests) {
  const present = new Set()
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  for (const { appId, runtime } of releases) {
    const digest = runtime.integrity?.slice(7)
    if (!/^[a-z][\w-]{0,63}$/.test(appId) || !/^[a-f0-9]{64}$/.test(digest) || runtime.entryUrl !== origin + '/' + appId + '/' + digest + '/') {
      throw new Error('已发布的桌面资源地址无效 ' + appId)
    }
    const manifest = JSON.parse(await read(runtime.entryUrl + 'artifact.json', 1024 * 1024))
    const files = Object.entries(manifest.files)
    if (manifest.protocol !== 1 || manifest.appId !== appId || manifest.digest !== digest || !manifest.files['index.html'] || files.length > 2000 || hash(JSON.stringify(manifest.files)) !== digest) {
      throw new Error('资源清单校验失败 ' + appId)
    }
    const root = path.join(directory, appId, digest)
    let remaining = 20 * 1024 * 1024
    for (const [name, checksum] of files) {
      if (!name.split('/').every((part) => /^[\w@-][\w.@-]*$/.test(part))) {
        throw new Error('资源路径无效')
      }
      const bytes = await read(runtime.entryUrl + name, Math.min(remaining, 5 * 1024 * 1024))
      if (hash(bytes) !== checksum) {
        throw new Error('文件摘要不匹配 ' + name)
      }
      remaining -= bytes.length
      await mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await writeFile(path.join(root, name), bytes)
    }
    await writeFile(root + '.complete', digest)
    present.add(runtime.entryUrl)
  }
  if (guests.protocol !== 1 || !guests.applications.every((release) => present.has(release.runtime.entryUrl))) {
    throw new Error('内置目录与发布版本不一致，请重新构建')
  }
  await writeFile(path.join(directory, 'index.json'), JSON.stringify(guests))
}
