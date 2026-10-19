import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { format } from 'prettier'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const pkg = (name, layer, dependencies, scripts) => ({ name: `@t-box/${name}-${layer}`, version: '1.0.0', type: 'module', private: true, ...(layer === 'web' ? {} : { exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, files: ['dist'] }), scripts, dependencies, devDependencies: { typescript: '~5.9.3', ...(layer === 'web' ? { '@vitejs/plugin-vue': '6.0.9', 'vite': '8.3.2', 'vue-tsc': '^3.2.5' } : {}) } })

/** Scaffold only. Installing dependencies, registering backends and publishing remain explicit. */
export async function createApplication(root, appId, port = 5180) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(appId || '') || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Usage: pnpm create:application <lowercase-app-id> [port:1024-65535]')
  }
  const path = join(root, 'apps', appId)
  const lint = new ESLint({ cwd: workspace, fix: true })
  // No recursive mkdir at the target: a typo cannot overwrite an existing app.
  await mkdir(path)
  const write = async (file, content) => {
    const target = join(path, file)
    await mkdir(dirname(target), { recursive: true })
    const raw = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n'
    const source = await format(raw, { filepath: target, semi: false, singleQuote: true })
    const [checked] = await lint.lintText(source, { filePath: join(workspace, 'apps', appId, file) })
    if (checked.errorCount) {
      throw new Error('Generated template is invalid: ' + file + ' (' + checked.messages.map((message) => message.ruleId).join(',') + ')')
    }
    await writeFile(target, checked.output || source, { flag: 'wx' })
  }
  const serverTsconfig = JSON.parse(await readFile(join(workspace, 'apps/calculator/server/tsconfig.json'), 'utf8'))
  const webTsconfig = JSON.parse(await readFile(join(workspace, 'apps/calculator/web/tsconfig.json'), 'utf8'))
  const scripts = { build: 'tsc -p tsconfig.json', typecheck: 'tsc --noEmit', dev: 'tsc -p tsconfig.json --watch --preserveWatchOutput' }
  const tool = appId.replaceAll('-', '_')
  await write('contracts/package.json', pkg(appId, 'contracts', { '@t-box/app-contracts': 'workspace:*' }, scripts))
  await write('server/package.json', pkg(appId, 'server', { '@t-box/app-contracts': 'workspace:*', '@t-box/app-server-sdk': 'workspace:*', [`@t-box/${appId}-contracts`]: 'workspace:*' }, scripts))
  await write('web/package.json', pkg(appId, 'web', { '@t-box/app-web-sdk': 'workspace:*', '@t-box/app-sdk': 'workspace:*', [`@t-box/${appId}-contracts`]: 'workspace:*', 'vue': '3.5.43' }, {
    dev: `vite --host 0.0.0.0 --port ${port} --strictPort`,
    build: `vue-tsc --noEmit && vite build && node ../../../scripts/build-application-artifact.mjs ${appId}`,
    typecheck: 'vue-tsc --noEmit',
  }))
  await write('contracts/tsconfig.json', serverTsconfig)
  await write('server/tsconfig.json', serverTsconfig)
  await write('web/tsconfig.json', webTsconfig)
  await write('build.config.json', { appId, package: `@t-box/${appId}-web`, releasePackage: `@t-box/${appId}-server`, releaseModule: 'server/dist/release.js', releaseExport: 'applicationRelease' })
  await write('app.manifest.ts', 'export { applicationRelease } from \'./server/src/release.js\'\n')
  await write('contracts/src/index.ts', `import type { ApplicationManifest } from '@t-box/app-contracts'
export const manifest = { id: '${appId}', name: '${appId}', description: '独立应用', version: '1.0.0', icon: 'apps', color: 'blue', skillIds: ['${appId}-basic'] } as const satisfies ApplicationManifest
export function double(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'value') || typeof (value as { value?: unknown }).value !== 'number' || !Number.isFinite((value as { value: number }).value) || Math.abs((value as { value: number }).value) > 1e12) throw new Error('请输入绝对值不超过 1e12 的有限数字')
  return { result: (value as { value: number }).value * 2 }
}
`)
  await write('server/src/release.ts', `import type { AppRelease } from '@t-box/app-contracts'
import { manifest } from '@t-box/${appId}-contracts'
export const applicationRelease: AppRelease = {
  appId: '${appId}', releaseId: \`${appId}-\${manifest.version}\`, manifest, protocol: 1, kind: 'user', platforms: ['web', 'android', 'ios'],
  runtime: { type: 'web', entryUrl: 'http://localhost:${port}/', integrity: 'sha256-' + '0'.repeat(64) },
  backend: { type: 'local', binding: '${appId}' }, permissions: ['${appId}.double', 'files', 'storage'], clientTools: ['${tool}_focus'], defaultInstalled: false,
}
`)
  await write('server/src/index.ts', `import type { ApplicationBackend, ApplicationModule } from '@t-box/app-server-sdk'
import { ApplicationError, definition } from '@t-box/app-server-sdk'
import { double, manifest } from '@t-box/${appId}-contracts'
export { applicationRelease } from './release.js'
// This example has no side effects. Add durable receipts before introducing writes.
export const backend: ApplicationBackend = {
  async lifecycle(request) { return { status: 'completed', receipt: { appId: request.appId, generation: request.generation, action: request.action } } },
  async operation() { return null },
  async invoke(request, signal) { signal?.throwIfAborted(); if (request.method !== 'double') throw new ApplicationError('METHOD_NOT_FOUND', '方法不存在'); return double(request.arguments) },
}
export function createApplicationModule(): ApplicationModule {
  return { id: '${appId}', contractVersion: '1.0', manifest,
    skills: { '${appId}-basic': { title: '基础工具', description: '数字计算与应用界面操作', version: '1.0.0', tools: ['${tool}_double', '${tool}_focus'], instructions: '只在用户需要时使用工具；前端操作需要等待设备在线。' } },
    tools: {
      ${tool}_double: { title: '计算两倍值', execution: 'server', effect: 'read', successSummary: '计算完成', definition: definition('${tool}_double', '计算一个数字的两倍。', { value: { type: 'number' } }), handler: async (args) => double(args) },
      ${tool}_focus: { title: '聚焦输入框', execution: 'client', effect: 'ui', clientAction: 'application_invoke', successSummary: '输入框已聚焦', definition: definition('${tool}_focus', '在用户设备上聚焦应用输入框。', {}), normalizeClientArguments: () => ({}), sanitizeClientResult: (result) => result.ok ? { ok: true, data: { focused: true } } : result },
    },
    navigation: { properties: {}, parse: () => ({}) },
  }
}
`)
  await write('web/index.html', `<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${appId}</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n`)
  await write('web/vite.config.ts', 'import vue from \'@vitejs/plugin-vue\'\nimport { defineConfig } from \'vite\'\nimport { workspaceSources } from \'../../../scripts/vite-workspace.mjs\'\nexport default defineConfig({ plugins: [workspaceSources(), vue()], base: \'./\', build: { target: \'es2022\' } })\n')
  await write('web/src/main.ts', `import type { AppClient } from '@t-box/app-sdk'
import { connectAppClient } from '@t-box/app-web-sdk'
import { createApp } from 'vue'
import App from './App.vue'
let input: HTMLInputElement | null = null
connectAppClient({ ${tool}_focus: () => { input?.focus(); return { focused: true } } }).then((connection) => {
  createApp(App, { client: connection.client as AppClient, bindInput: (node: HTMLInputElement) => input = node }).mount('#app')
  connection.ready()
  window.addEventListener('pagehide', () => connection.client.dispose(), { once: true })
}).catch((error) => document.getElementById('app')!.textContent = error instanceof Error ? error.message : '连接失败')
`)
  await write('web/src/App.vue', `<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import { manifest } from '@t-box/${appId}-contracts'
import { onMounted, ref } from 'vue'
const props = defineProps<{ client: AppClient, bindInput: (node: HTMLInputElement) => void }>()
const input = ref<HTMLInputElement>()
const value = ref('1')
const result = ref('')
const busy = ref(false)
const files = ref<string[]>([])
async function calculate() { busy.value = true; try { const response = await props.client.api.invoke<{ result: number }>('double', { value: Number(value.value) }); result.value = String(response.result) } catch (error) { result.value = error instanceof Error ? error.message : '计算失败' } finally { busy.value = false } }
async function upload() { try { files.value = (await props.client.files.pick({ multiple: true })).map((file) => file.name) } catch (error) { result.value = error instanceof Error ? error.message : '上传失败' } }
onMounted(() => props.bindInput(input.value!))
</script>
<template><main><header><button aria-label="返回" @click="client.navigation.back()">‹</button><h1>{{ manifest.name }}</h1></header><form @submit.prevent="calculate"><label>数字<input ref="input" v-model="value" inputmode="decimal" required></label><button :disabled="busy">计算两倍值</button></form><p role="status">{{ result }}</p><button @click="upload">选择并上传文件</button><ul><li v-for="file in files" :key="file">{{ file }}</li></ul></main></template>
<style>body{margin:0;font:14px system-ui,sans-serif;color:#223e37;background:#f8faf9}main{max-width:640px;margin:auto;padding:20px}header{display:flex;align-items:center;gap:14px}h1{font-size:18px}form,label{display:grid;gap:12px}button,input{font:inherit;min-height:42px;border:1px solid #dce6e1;border-radius:9px;padding:9px 12px;background:white}button{cursor:pointer}input:focus{outline:1px solid #619b85}p{line-height:1.6}</style>\n`)
  await write('README.md', `# ${appId}\n\n此应用拥有独立 contracts/web/server 包，使用宿主 SDK 登录上下文、文件、存储和导航，不读取宿主 token。示例包含后端只读工具和前端 UI 工具。\n\n1. 在根目录运行 pnpm install，再 pnpm build:contracts。\n2. 在 api/package.json 增加 @t-box/${appId}-server workspace 依赖，在 api/src/application-platform/catalog.ts 引入 applicationRelease，并在 PlatformService 的组装入口将 backend 绑定到 ${appId}。\n3. 如需 AI 调用，在 api/src/applications/registry.ts 组装 createApplicationModule()；业务代码保留在此应用，勿修改 AI runner。\n4. pnpm --filter @t-box/${appId}-web dev 启动端口 ${port}。更新版本时只修改 contracts 的 manifest.version，releaseId 自动跟随。\n5. 运行 pnpm apps:workflow 更新手动 Actions 下拉列表；pnpm pack:application ${appId} 自动读取 manifest.version 生成发布包；更新说明与提示在后台填写，发布后用户安装并确认权限。\n\n生产发布 URL/摘要由应用发布管道生成，localhost 与零摘要仅供开发。此示例无持久业务副作用；写入前必须实现自有事务、invocationId 去重及安装 generation 校验。独立远程后端可使用 createApplicationBackendHandler 和 bindRemoteTools，服务端凭据由部署绑定注入，绝不能放进前端。\n`)
  return path
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appId, port] = process.argv.slice(2)
  console.log(await createApplication(workspace, appId, port === undefined ? 5180 : Number(port)))
}
