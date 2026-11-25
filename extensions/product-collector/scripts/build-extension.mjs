import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
await build({
  entryPoints: ['src/extension/background.ts', 'src/extension/offscreen.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
})
const matches = ['https://www.dianxiaomi.com/*']
await build({ entryPoints: ['src/extension/content.ts', 'src/extension/account-bridge.ts'], outdir: 'dist', bundle: true, format: 'iife', loader: { '.css': 'text' }, target: 'chrome120', minify: false })
const manifest = {
  manifest_version: 3,
  name: 'T方舟采集插件',
  version: pkg.version,
  minimum_chrome_version: '120',
  description:
    '读取店小秘采集列表，分页导入临时预览、去重核对并导出商品资料。',
  action: {
    default_title: 'T方舟采集插件',
  },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['scripting', 'storage', 'offscreen'],
  host_permissions: [...matches, 'https://tboxos.cn/*', 'https://api.tboxos.cn/*'],
  externally_connectable: { matches: ['https://tboxos.cn/*'] },
  content_scripts: [
    { matches, js: ['content.js'], run_at: 'document_idle' },
    { matches: ['https://tboxos.cn/*'], js: ['account-bridge.js'], run_at: 'document_idle' },
  ],
  web_accessible_resources: [{ resources: ['index.html', 'assets/*', 'icon*.png'], matches }],
  icons: { 16: 'icon16.png', 48: 'icon48.png', 128: 'icon128.png' },
  content_security_policy: {
    extension_pages:
      'script-src \'self\'; object-src \'none\'; base-uri \'none\'',
  },
}
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
