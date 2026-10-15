import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createOfflineWorker } from './offline-worker.mjs'

export function verifiedOffline() {
  let outDir
  return {
    name: 'tbox-verified-static-cache',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: './tbox-offline.js' }, injectTo: 'body' }]
    },
    async closeBundle() {
      const registration = `if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) { const base = new URL('./', import.meta.url); navigator.serviceWorker.register(new URL('tbox-offline-sw.js', base), {scope:base.pathname}).catch(()=>{}); }\n`
      await writeFile(join(outDir, 'tbox-offline.js'), registration)
      const files = []
      const scan = async (folder = '') => {
        for (const item of await readdir(join(outDir, folder), { withFileTypes: true })) {
          const path = folder ? `${folder}/${item.name}` : item.name
          if (item.isDirectory()) {
            await scan(path)
          } else if (item.isFile() && path !== 'tbox-offline-sw.js' && !path.endsWith('.map')) {
            files.push({ path, sha256: createHash('sha256').update(await readFile(join(outDir, path))).digest('hex') })
          }
        }
      }
      await scan()
      files.sort((a, b) => a.path.localeCompare(b.path))
      const version = createHash('sha256').update(JSON.stringify(files)).digest('hex')
      await writeFile(join(outDir, 'tbox-offline-sw.js'), createOfflineWorker({ version, files }))
    },
  }
}
