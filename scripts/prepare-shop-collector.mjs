import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const extension = join(root, 'extensions/product-collector')
const result = spawnSync('pnpm', ['run', 'pack'], { cwd: extension, stdio: 'inherit' })
if (result.error || result.status !== 0) {
  throw new Error('Collector build failed; refusing to ship an application with a stale plugin', { cause: result.error })
}
const { version } = JSON.parse(await readFile(join(extension, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Invalid collector version')
}
const file = `tark-collector-${version}.zip`
const bytes = await readFile(join(root, 'output/collector-releases', file))
const metadata = { version, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
const destination = join(root, 'apps/shop-tools/web/public/downloads')
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
await writeFile(join(destination, file), bytes)
await writeFile(join(destination, 'collector.json'), JSON.stringify(metadata, null, 2) + '\n')
await writeFile(join(destination, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>采集插件下载与安装</title>
<style>body{font:16px/1.8 system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 24px;color:#24334a}a{color:#b43d16}li{margin:12px 0}code{overflow-wrap:anywhere}small{color:#596779}</style></head>
<body><h1>T方舟采集插件</h1><p>版本 ${version} · Chrome 120 或更高版本 · 桌面浏览器使用</p>
<p><a href="${file}" download="${file}">下载插件 ZIP（${Math.ceil(bytes.length / 1024)} KB）</a></p>
<ol><li>解压 ZIP，将文件夹放在固定位置，安装后请勿删除或移动。</li><li>在 Chrome 地址栏输入 <code>chrome://extensions</code>，开启右上角“开发者模式”。</li><li>点击“加载已解压的扩展程序”，选择包含 <code>manifest.json</code> 的文件夹。</li><li>刷新店小秘页面，打开插件并登录，即可确认采集到个人采集表。</li></ol>
<p>更新时关闭插件页面，将新版解压文件覆盖到原文件夹，在扩展管理页面点击该插件的重新加载按钮，再刷新店小秘。此安装方式不会自动更新。</p>
<p>ZIP 不能直接导入 Chrome。普通 Windows / macOS Chrome 也不支持直接安装自行打包的 CRX；企业受管设备另有部署方式。</p>
<small>SHA-256：<code>${metadata.sha256}</code></small></body></html>`)
console.info(`Bundled collector ${version}: ${bytes.length} bytes`)
