import { setTimeout as delay } from 'node:timers/promises'

export function httpsUrl(value, name) {
  if (!value?.trim()) {
    throw new Error('缺少 ' + name + '，请在项目根目录的 .env.release.local 中填写')
  }
  if (!URL.canParse(value)) {
    throw new Error(name + ' 格式错误，请在 .env.release.local 中填写完整 HTTPS 地址')
  }
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(name + ' 需要 HTTPS 地址')
  }
  return url.href.replace(/\/$/, '')
}

export async function adminClient(base, username, password) {
  if (!username || !password) {
    throw new Error('请在 .env.release.local 配置后台账号和密码')
  }
  let cookie
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + '/admin' + path, {
      method,
      redirect: 'error',
      headers: { 'X-Admin-Request': '1', ...(cookie && { cookie }), ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(method === 'GET' ? 30000 : 180000),
    })
    if (response.status === 204) {
      return
    }
    const result = await response.json()
    if (!response.ok) {
      throw new Error(method + ' ' + path + ' · HTTP ' + response.status + ' · ' + (result.error?.code || '请求失败'))
    }
    if (path === '/session' && method === 'POST') {
      cookie = response.headers.getSetCookie().map((s) => s.split(';')[0]).find((s) => s.startsWith('tbox_admin='))
      if (!cookie) {
        throw new Error('后台登录未返回会话')
      }
    }
    return result.data
  }
  await request('/session', 'POST', { username, password })
  return request
}

export function targetEntry(apps, target) {
  const app = apps.applications.find((a) => a.appId === target.id)
  const entry = app?.releases.find((e) => e.release.releaseId === target.receipt)
  if (!entry || entry.release.manifest.version !== target.version || entry.readiness.development || entry.release.runtime.type !== target.runtime) {
    throw new Error('后台找不到本批正式构建：' + target.id + ' ' + target.version)
  }
  if (app.currentReleaseId === target.receipt && entry.status === 'published') {
    return { live: true, entry }
  }
  if (app.currentReleaseId !== target.expected || entry.status !== 'submitted' || !(entry.readiness.ready || entry.readiness.pendingVerification)) {
    throw new Error(target.id + ' 当前线上基线、候选状态或发布资格已改变，请在后台核对')
  }
  return { live: false, entry }
}

export async function publishApp(request, target, notes) {
  const read = async () => targetEntry(await request('/applications'), target)
  let item = await read()
  if (item.live) {
    return
  }
  const path = '/application-releases/' + encodeURIComponent(target.receipt)
  if (item.entry.releaseNotes !== notes) {
    await request(path + '/metadata', 'PATCH', { revision: item.entry.revision, releaseNotes: notes })
    item = await read()
    if (item.live) {
      return
    }
    if (item.entry.releaseNotes !== notes) {
      throw new Error('更新说明已被修改：' + target.id)
    }
  }
  await request(path + '/transitions', 'POST', { action: 'publish', revision: item.entry.revision, expectedCurrentReleaseId: target.expected })
  if (!(await read()).live) {
    throw new Error('子应用发布结果待核实：' + target.id)
  }
}

export function systemTarget(list, target) {
  const row = list.candidates.find((r) => r.build === target.receipt)
  if (!row || row.version !== target.version || !row.shared || (row.coreVersion ?? null) !== (target.coreVersion ?? null)) {
    throw new Error('后台缺少版本完全匹配的共享 UI / Mac 核心候选')
  }
  if (row.state === 'live' && list.current?.build === row.build) {
    return row
  }
  if (!['pending', 'publishing', 'failed'].includes(row.state) || (list.current?.build ?? null) !== target.expected || (list.interrupted && list.interrupted.build !== row.build)) {
    throw new Error('主界面线上基线或候选状态已改变')
  }
  return row
}

export async function publishUi(request, target, notes, web) {
  const read = async () => systemTarget(await request('/system-releases'), target)
  const row = await read()
  if (row.state !== 'live') {
    await request('/system-releases/' + row.build + '/publish', 'POST', { expected: target.expected, notes: row.notes || notes })
    if ((await read()).state !== 'live') {
      throw new Error('主界面尚未生效')
    }
  }
  for (let i = 0; i < 12; i++) {
    const response = await fetch(web + '/web-version.json?build=' + row.build, { signal: AbortSignal.timeout(15000), cache: 'no-store' })
    if (response.ok) {
      const marker = await response.json()
      if (marker.version === target.version && marker.build === row.build) {
        return
      }
    }
    await delay(5000)
  }
  throw new Error('公网版本文件尚未指向本批构建，稍后 --resume 再验证')
}
