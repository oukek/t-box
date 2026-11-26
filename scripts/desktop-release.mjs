import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOssClient, ossClientOptions } from '../deploy/oss/client.mjs'
import { releaseVersions } from './release-versions.mjs'

const env = process.env
const root = fileURLToPath(new URL('../', import.meta.url))
const work = path.join(root, 'output/desktop-release', env.GITHUB_RUN_ID || 'local')
const dist = path.join(root, 'desktop/dist')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const config = path.join(work, 'tauri.json')
const architectures = ['aarch64', 'x86_64']
function bundleDir(arch) {
  return path.join(root, 'desktop/src-tauri/target', arch + '-apple-darwin/release/bundle')
}
function updateFile(arch) {
  return path.join(bundleDir(arch), 'macos/T方舟.app.tar.gz')
}
async function installerFile(arch) {
  const dir = path.join(bundleDir(arch), 'dmg')
  const images = (await readdir(dir)).filter((name) => name.endsWith('.dmg'))
  if (images.length !== 1) {
    throw new Error('缺少唯一的 ' + arch + ' 安装镜像')
  }
  return path.join(dir, images[0])
}
const uiFile = path.join(work, 'ui.json')
function run(exe, args, extra = {}) {
  const childEnv = { ...env, ...extra }
  for (const name of Object.keys(childEnv)) {
    if (name.startsWith('APPLE_') && !childEnv[name]) {
      delete childEnv[name]
    }
  }
  const r = spawnSync(exe, args, { cwd: root, stdio: 'inherit', env: childEnv })
  if (r.status !== 0) {
    throw new Error(exe + ' 构建失败')
  }
}
async function api(route, body) {
  const url = new URL(env.API_BASE_URL + route)
  if (url.protocol !== 'https:' || !env.APP_IMPORT_TOKEN) {
    throw new Error('请配置 HTTPS API 和构建凭证')
  }
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.APP_IMPORT_TOKEN }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(180000) })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result?.error?.message || '桌面发布接口请求失败')
  }
  return result.data
}
async function reserve() {
  const requested = env.DESKTOP_MODE
  if (!['ui', 'both'].includes(requested)) {
    throw new Error('构建类型无效')
  }
  const base = await api('/system-builds/desktop/base')
  if (!base && requested !== 'both') {
    throw new Error('首次发布请使用联合构建')
  }
  // A full installer can embed the approved UI unchanged when only the binary advances.
  const mode = requested === 'both' && base?.ui.version === releaseVersions.ui ? 'core' : requested
  const choices = { ...(mode !== 'core' && { ui: releaseVersions.ui }), ...(mode !== 'ui' && { core: releaseVersions.macos.core }) }
  const r = await api('/system-builds/reserve', { batch: env.GITHUB_REPOSITORY.toLowerCase() + '/' + env.GITHUB_RUN_ID, commit: env.GITHUB_SHA, channel: mode === 'core' ? 'macos' : 'shared', ...choices })
  if (r.ui !== (choices.ui ?? null) || r.core !== (choices.core ?? null)) {
    throw new Error('预留版本与 release-versions.json 不一致')
  }
  await mkdir(work, { recursive: true })
  await writeFile(path.join(work, 'reservation.json'), JSON.stringify({ ...r, base: base?.build ?? null }))
  const status = await api('/system-builds/desktop/' + r.build + '/status')
  if (r.core && !status.dualMacInstallers) {
    throw new Error('请先部署支持 Intel 和 DMG 的方舟后端，再构建 Mac 整包')
  }
  await appendFile(env.GITHUB_ENV, 'BUILD_NEW_UI=' + Boolean(r.ui) + '\nDESKTOP_SUBMITTED=' + status.desktop + '\nWEB_SUBMITTED=' + status.web + '\n')
  if (!r.ui && !status.desktop) {
    // Use the exact approved bytes for the bundled fallback when only the core is rebuilt.
    const response = await fetch(base.url, { redirect: 'error', signal: AbortSignal.timeout(90000) })
    if (!response.ok) {
      throw new Error('已发布界面下载失败')
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha(bytes) !== base.ui.digest) {
      throw new Error('线上界面摘要不匹配')
    }
    await writeFile(uiFile, bytes)
    const pack = JSON.parse(bytes)
    if (pack.version !== base.ui.version || pack.protocol !== 1 || !pack.files['index.html']) {
      throw new Error('已发布界面不兼容')
    }
    const target = path.join(work, 'embedded')
    for (const [name, content] of Object.entries(pack.files)) {
      if (!name.split('/').every((p) => /^[\w@-][\w.@-]*$/.test(p))) {
        throw new Error('界面资源路径无效')
      }
      const dest = path.join(target, name)
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, Buffer.from(content, 'base64'))
    }
  }
  await appendFile(env.GITHUB_ENV, 'TBOX_WEB_BUILD_ID=' + r.build + '\nTBOX_UI_VERSION=' + (r.ui || base.ui.version) + '\n')
}
async function buildUi() {
  run('node', ['desktop/build-ui.mjs'])
  const marker = JSON.parse(await readFile(path.join(dist, 'desktop-ui-version.json'), 'utf8'))
  if (marker.version !== env.TBOX_UI_VERSION || marker.build !== env.TBOX_WEB_BUILD_ID) {
    throw new Error('桌面内置界面与本次预留版本或构建编号不一致')
  }
  run('node', ['desktop/pack-ui.mjs', dist, env.TBOX_UI_VERSION, uiFile])
}
async function signUi() {
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error('缺少界面签名密钥')
  }
  run('pnpm', ['--filter', '@t-box/desktop', 'exec', 'tauri', 'signer', 'sign', '--app-version', env.TBOX_UI_VERSION, uiFile])
}
async function buildCore() {
  for (const name of ['APPLE_SIGNING_IDENTITY', 'APPLE_TEAM_ID', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_ID', 'APPLE_PASSWORD']) {
    if (!env[name]?.trim()) {
      throw new Error('正式桌面核心构建缺少 ' + name)
    }
  }
  if (!env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application:')) {
    throw new Error('正式桌面核心需要 Developer ID Application 签名身份的完整名称')
  }
  const r = JSON.parse(await readFile(path.join(work, 'reservation.json')))
  const uiDigest = sha(await readFile(uiFile))
  const metadata = path.join(work, 'desktop-release.json')
  await writeFile(metadata, JSON.stringify({ protocol: 1, uiDigest, uiVersion: env.TBOX_UI_VERSION }))
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || !env.TBOX_CORE_PUBLIC_KEY || !env.TBOX_UI_PUBLIC_KEY || !env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error('核心构建需要 Apple Silicon macOS 和签名配置')
  }
  await writeFile(config, JSON.stringify({ productName: 'T方舟', identifier: 'cn.tboxos.desktop', version: r.core, build: { beforeBuildCommand: '', frontendDist: r.ui ? dist : path.join(work, 'embedded') }, plugins: { updater: { pubkey: env.TBOX_CORE_PUBLIC_KEY } }, bundle: { createUpdaterArtifacts: true, resources: { [metadata]: 'desktop-release.json' }, macOS: { signingIdentity: env.APPLE_SIGNING_IDENTITY } } }))
  for (const arch of architectures) {
    const target = arch + '-apple-darwin'
    run('rustup', ['target', 'add', target])
    run('pnpm', ['--filter', '@t-box/desktop', 'exec', 'tauri', 'build', '--target', target, '--bundles', 'app,dmg', '--config', config], { PATH: '/usr/bin:' + env.PATH, TBOX_UPDATE_ENDPOINT: env.API_BASE_URL + '/system-updates', TBOX_ARTIFACT_ORIGIN: env.APP_ARTIFACT_ORIGIN })
    const dmg = await installerFile(arch)
    run('bash', ['scripts/verify-macos-bundle.sh', arch, updateFile(arch), dmg])
    const installerTag = r.core + (arch === 'aarch64' ? '-dmg.arm64' : '-dmg.intel')
    run('pnpm', ['--filter', '@t-box/desktop', 'exec', 'tauri', 'signer', 'sign', '--app-version', installerTag, dmg])
  }
}
export async function stageDesktopCandidate(r, files, client, register) {
  async function upload(file, ext) {
    const bytes = await readFile(file)
    const digest = sha(bytes)
    const signature = (await readFile(file + '.sig', 'utf8')).trim()
    const key = 'desktop-candidates/' + r.build + '/' + digest + '.' + ext
    try {
      await client.put(key, bytes, { headers: { 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private', 'Content-MD5': createHash('md5').update(bytes).digest('base64') } })
    } catch (e) {
      if (e.code !== 'FileAlreadyExists') {
        throw e
      }
    }
    return { digest, signature }
  }
  const body = { build: r.build, base: r.base }
  if (r.ui) {
    body.ui = await upload(files.ui, 'json')
  }
  if (r.core) {
    body.core = await upload(files.core, 'app.tar.gz')
    body.core.distribution = {
      intel: await upload(files.intel, 'app.tar.gz'),
      installers: {
        aarch64: await upload(files.armDmg, 'dmg'),
        x86_64: await upload(files.intelDmg, 'dmg'),
      },
    }
  }
  await register(body)
}
async function submit() {
  const r = JSON.parse(await readFile(path.join(work, 'reservation.json')))
  const files = { ui: uiFile }
  if (r.core) {
    Object.assign(files, { core: updateFile('aarch64'), intel: updateFile('x86_64'), armDmg: await installerFile('aarch64'), intelDmg: await installerFile('x86_64') })
  }
  await stageDesktopCandidate(r, files, createOssClient(ossClientOptions(env.WEB_OSS_BUCKET, env)), (body) => api('/system-builds/desktop', body))
  if (env.GITHUB_STEP_SUMMARY && r.core) {
    await appendFile(env.GITHUB_STEP_SUMMARY, 'Apple 芯片与 Intel 安装镜像、自动更新归档已登记。可在后台「系统发布 → 桌面端」选择芯片下载体验版。\n')
  }
  console.info(r.ui ? '桌面候选已登记，网页就绪后请在系统发布的主界面页确认。' : '核心候选已登记，请在系统发布的桌面端页确认。')
}
const commands = { reserve, 'build-ui': buildUi, 'sign-ui': signUi, 'build-core': buildCore, submit }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  commands[process.argv[2]]().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
