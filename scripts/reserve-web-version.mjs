import { appendFile } from 'node:fs/promises'
import { parseSystemVersion } from '../packages/app-contracts/src/system-version.ts'

const env = process.env
const change = env.UI_CHANGE || 'patch'
const manual = env.UI_VERSION || ''
if (env.TARGET === 'admin') {
  if (manual || !['manual', 'patch'].includes(change)) {
    throw new Error('仅发布后台时，请保留默认版本选项并清空主界面版本')
  }
  process.exit(0)
}
if (change === 'manual') {
  parseSystemVersion(manual)
} else if (manual || !['major', 'minor', 'patch'].includes(change)) {
  throw new Error('自动递增模式请留空手动目标版本')
}
const endpoint = new URL(env.API_BASE_URL + '/system-builds/reserve')
if (endpoint.protocol !== 'https:' || !env.APP_IMPORT_TOKEN) {
  throw new Error('版本预留需要 HTTPS API 和已配置的 APP_IMPORT_TOKEN')
}
const response = await fetch(endpoint, {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(30000),
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.APP_IMPORT_TOKEN },
  body: JSON.stringify({
    batch: env.GITHUB_REPOSITORY.toLowerCase() + '/' + env.GITHUB_RUN_ID,
    commit: env.GITHUB_SHA,
    ui: change === 'manual' ? manual : change,
  }),
})
if (!response.ok) {
  const failure = await response.json().catch(() => null)
  throw new Error('主界面版本预留失败（' + response.status + '）：' + (failure?.error?.message || '请检查后端部署和构建凭证'))
}
const { data } = await response.json()
parseSystemVersion(data.ui)
if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(data.build)) {
  throw new Error('无效的构建标识')
}
await appendFile(env.GITHUB_ENV, 'TBOX_UI_VERSION=' + data.ui + '\nTBOX_WEB_BUILD_ID=' + data.build + '\n')
console.info('本次主界面版本 ' + data.ui)
