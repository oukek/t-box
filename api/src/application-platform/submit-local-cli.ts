import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validId } from '@t-box/app-contracts'
import { getConfig } from '../config.js'
import { createDataSource } from '../db/data-source.js'
import { ErrorCode } from '../error-codes.js'
import { PlatformService } from '../platform/service.js'
import { ApplicationPublishing } from './publishing.js'

// Build/DB access is deliberately a local operator command, never a web request.
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(getConfig().mysql.host)) {
  throw ErrorCode.INVALID_APP_PUBLICATION('此命令只可用于本机开发数据库；正式部署使用应用发布工作流')
}
const appId = process.argv[2]
const bundleFile = process.argv[3]
if (!validId(appId) || !bundleFile || process.argv.length !== 4) {
  throw ErrorCode.INVALID_APP_PUBLICATION('用法：pnpm apps:submit:local <应用 id 或 all>')
}
const bundle = JSON.parse(await readFile(resolve(bundleFile), 'utf8')) as {
  protocol?: number
  appId?: string
  version?: string
  artifact?: string
  files?: { path: string, content: string }[]
}
if (bundle.protocol !== 1 || bundle.appId !== appId || typeof bundle.version !== 'string' || typeof bundle.artifact !== 'string') {
  throw ErrorCode.INVALID_APP_PUBLICATION('构建包与应用声明不一致')
}
const source = await createDataSource().initialize()
try {
  const platform = new PlatformService(source)
  const publishing = new ApplicationPublishing(source, platform.applications)
  const stored = await publishing.artifacts.upload(appId, { files: bundle.files })
  if (stored.digest !== bundle.artifact) {
    throw ErrorCode.INVALID_APP_ARTIFACT('构建包摘要不一致')
  }
  const result = await publishing.submitLocalBuild(appId, bundle.version, stored.digest)
  process.stdout.write(`${appId} v${bundle.version}：${result.status}，${result.releaseId}。需在后台手动发布。\n`)
} finally {
  await source.destroy()
}
