import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createOfflineWorker } from './offline-worker.mjs'
import { createResourceInstaller } from './resource-installer.mjs'

export function verifiedOffline({ application = false } = {}) {
  let outDir
  return {
    name: 'tbox-verified-static-cache',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    transformIndexHtml() {
      return [
        ...(application ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', 'content': 'default-src \'none\'; script-src \'self\'; worker-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; media-src \'self\' blob:; connect-src \'self\'; font-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\'' }, injectTo: 'head-prepend' }] : []),
        { tag: 'script', attrs: { type: 'module', src: './tbox-offline.js' }, injectTo: 'body' },
      ]
    },
    async closeBundle() {
      if (application) {
        await writeFile(join(outDir, 'tbox-resource.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; worker-src \'self\'; connect-src \'self\'; base-uri \'none\'; form-action \'none\'"><script src="./tbox-resource.js" defer></script>')
        await writeFile(join(outDir, 'tbox-resource.js'), createResourceInstaller())
      }
      const registration = `if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.() && !new URLSearchParams(location.hash.slice(1)).has('tbox-local')) { const base = new URL('./', import.meta.url); ${application ? 'navigator.serviceWorker.getRegistration(base.href).then(registration => registration?.active || navigator.serviceWorker.register(new URL("tbox-offline-sw.js", base), {scope:base.pathname})).catch(()=>{});' : 'navigator.serviceWorker.register(new URL("tbox-offline-sw.js", base), {scope:base.pathname}).catch(()=>{});'} }\n`
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
      // A worker-only fix must get a new cache too; failed installation cannot delete an active version's cache.
      const version = createHash('sha256').update(JSON.stringify(files)).update(createOfflineWorker.toString()).digest('hex')
      await writeFile(join(outDir, 'tbox-offline-sw.js'), createOfflineWorker({ version, files, application }))
    },
  }
}
