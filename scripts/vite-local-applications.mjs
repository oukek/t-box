import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { discoverApplications } from './application-builds.mjs'

/** Embed only the platform's trusted guest declarations. Production versions come from the public release catalog. */
export function localApplicationDeclarations(root) {
  const name = 'virtual:tbox-local-applications'
  let developmentServer
  return {
    name: 'tbox-local-application-declarations',
    configureServer(server) {
      developmentServer = server
    },
    resolveId(id) {
      return id === name ? '\0' + name : null
    },
    async load(id) {
      if (id !== '\0' + name) {
        return null
      }
      const releases = []
      for (const config of await discoverApplications(root)) {
        const compiled = join(root, 'apps', config.appId, config.releaseModule)
        const source = compiled.replace('/dist/', '/src/').replace(/\.js$/, '.ts')
        this.addWatchFile(join(root, 'apps', config.appId, 'build.config.json'))
        this.addWatchFile(source)
        // Vite development reads workspace source, so missing/stale dist never blocks guest tools.
        const module = developmentServer
          ? await developmentServer.ssrLoadModule(source)
          : await import(pathToFileURL(compiled).href)
        const release = module[config.releaseExport]
        if (release?.guestAccess === 'local' && release.kind === 'system' && release.defaultInstalled && release.runtime.type === 'web') {
          releases.push(release)
        }
      }
      return `export default ${JSON.stringify(releases)};`
    },
  }
}
