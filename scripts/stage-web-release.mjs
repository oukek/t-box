import { createHash } from 'node:crypto'
import { createOssClient } from '../deploy/oss/client.mjs'
import { collectBuildFiles, sha256 } from './application-builds.mjs'

export async function stageWebRelease(directory, settings, api, env = process.env, client = createOssClient(settings.clientOptions), request = fetch) {
  const { files } = await collectBuildFiles(directory)
  const marker = JSON.parse(Buffer.from(files.find((file) => file.path === 'web-version.json').content, 'base64').toString())
  if (!env.APP_IMPORT_TOKEN || marker.build !== env.TBOX_WEB_BUILD_ID || marker.version !== env.TBOX_UI_VERSION || !/^[a-f0-9-]{36}$/.test(marker.build)) {
    throw new Error('主界面候选必须使用本批次预留的版本和构建编号')
  }
  const bytes = Buffer.from(JSON.stringify(files))
  const digest = sha256(bytes)
  const key = 'system-candidates/' + marker.build + '/' + digest + '.json'
  try {
    await client.put(key, bytes, { mime: 'application/json', headers: {
      'Content-MD5': createHash('md5').update(bytes).digest('base64'),
      'x-oss-forbid-overwrite': 'true',
      'x-oss-object-acl': 'private',
    } })
  } catch (error) {
    if (error?.code !== 'FileAlreadyExists') {
      throw new Error('候选上传失败，请检查主站 OSS 写入权限及网络')
    }
  }
  const response = await request(api.href + '/system-builds/submit', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.APP_IMPORT_TOKEN },
    body: JSON.stringify({ build: marker.build, digest }),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new Error('候选登记失败（' + response.status + '）：' + (failure?.error?.message || '检查后端日志后重试'))
  }
  console.info('主界面 ' + marker.version + ' 已登记，请前往管理后台 → 应用管理 → 系统发布确认。')
}
