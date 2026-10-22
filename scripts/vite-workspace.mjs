import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const defaultRoot = fileURLToPath(new URL('../', import.meta.url))

/** Resolve public package exports, never private paths or arbitrary files in a workspace. */
function exportTarget(value, conditions = ['browser', 'import', 'default']) {
  if (typeof value === 'string') {
    return value
  }
  if (value === null) {
    return null
  }
  if (Array.isArray(value)) {
    return value.map((target) => exportTarget(target, conditions)).find((target) => target !== undefined)
  }
  if (value && typeof value === 'object') {
    for (const condition of conditions) {
      if (!Object.hasOwn(value, condition)) {
        continue
      }
      const target = exportTarget(value[condition], conditions)
      if (target !== undefined) {
        return target
      }
    }
  }
}

export function workspaceCatalog(root = defaultRoot) {
  const config = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'))
  if (!Array.isArray(config.packages) || !config.packages.every((item) => typeof item === 'string')) {
    throw new Error('pnpm-workspace.yaml must declare workspace package paths')
  }
  const included = config.packages.filter((path) => !path.startsWith('!')).map((path) => `${path}/package.json`)
  const excluded = config.packages.filter((path) => path.startsWith('!')).map((path) => `${path.slice(1)}/**`)
  const packages = new Map()
  const workspaces = []
  for (const file of globSync(included, { cwd: root, exclude: excluded })) {
    const path = resolve(root, file)
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    workspaces.push({ path: dirname(path), name: manifest.name, dependencies: new Set([...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.devDependencies || {}), ...Object.keys(manifest.peerDependencies || {}), ...Object.keys(manifest.optionalDependencies || {})]) })
    if (typeof manifest.name !== 'string' || !manifest.exports) {
      continue
    }
    if (packages.has(manifest.name)) {
      throw new Error(`Duplicate workspace name: ${manifest.name}`)
    }
    packages.set(manifest.name, { path: dirname(path), exports: manifest.exports })
  }
  return { packages, workspaces: workspaces.sort((a, b) => b.path.length - a.path.length), patterns: config.packages.filter((path) => !path.startsWith('!')) }
}

/**
 * tsx uses the same public Node package entries as Vite. Only development
 * redirects compiled exports; production keeps the original dist contract.
 */
export function workspaceSourcePaths(root = defaultRoot) {
  const paths = {}
  for (const [name, entry] of workspaceCatalog(root).packages) {
    const exports = typeof entry.exports === 'string' || !Object.keys(entry.exports).some((key) => key.startsWith('.'))
      ? { '.': entry.exports }
      : entry.exports
    for (const [subpath, value] of Object.entries(exports)) {
      const target = exportTarget(value, ['node', 'import', 'default'])
      const compiled = /^\.\/dist\/(.+)\.(?:mjs|js)$/.exec(target || '')
      if (!compiled) {
        continue
      }
      const id = subpath === '.' ? name : name + subpath.slice(1)
      paths[id] = ['ts', 'tsx', 'js', 'mjs'].map((extension) => resolve(entry.path, `src/${compiled[1]}.${extension}`))
    }
  }
  return paths
}

export function resolveWorkspaceSource(catalog, id, importer) {
  if (!id.startsWith('@')) {
    return null
  }
  const parts = id.split('/')
  const name = parts.slice(0, 2).join('/')
  const entry = catalog.packages.get(name)
  if (!entry) {
    return null
  }
  const owner = importer && !importer.includes(`${sep}node_modules${sep}`) && catalog.workspaces.find((item) => importer.startsWith(item.path + sep))
  if (owner && owner.name !== name && !owner.dependencies.has(name)) {
    throw new Error(`Undeclared workspace dependency: ${owner.name} imports ${name}. Declare it in package.json and run pnpm install.`)
  }
  const subpath = parts.length === 2 ? '.' : './' + parts.slice(2).join('/')
  if (subpath.includes('..') || subpath.includes('\\')) {
    return null
  }
  const exports = typeof entry.exports === 'string' || !Object.keys(entry.exports).some((key) => key.startsWith('.'))
    ? { '.': entry.exports }
    : entry.exports
  let target = Object.hasOwn(exports, subpath) ? exportTarget(exports[subpath]) : undefined
  if (!Object.hasOwn(exports, subpath)) {
    const patterns = Object.keys(exports).filter((key) => key.includes('*')).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length)
    for (const key of patterns) {
      const [prefix, suffix] = key.split('*')
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) {
        continue
      }
      const match = subpath.slice(prefix.length, suffix ? -suffix.length : undefined)
      target = exportTarget(exports[key])?.replaceAll('*', match)
      break
    }
  }
  if (!target?.startsWith('./')) {
    return null
  }
  // Production Node packages still export dist. Browser dev/build consumes the same source directly.
  const compiled = /^\.\/dist\/(.+)\.(?:mjs|js)$/.exec(target)
  const candidates = compiled
    ? ['ts', 'tsx', 'js', 'mjs'].map((extension) => resolve(entry.path, `src/${compiled[1]}.${extension}`))
    : [resolve(entry.path, target)]
  const source = candidates.find((path) => {
    const inside = relative(entry.path, path)
    return !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside) && existsSync(path)
  })
  if (!source) {
    throw new Error(`Workspace source entry missing: ${id}. Check ${entry.path}/package.json exports and src files.`)
  }
  return source
}

/** All browser entry points share this resolver; adding an app never requires a new alias. */
export function workspaceSources({ root = defaultRoot } = {}) {
  let catalog = workspaceCatalog(root)
  let timer
  let cleanup = () => {}
  return {
    name: 'tbox-workspace-sources',
    enforce: 'pre',
    config() {
      return { resolve: { dedupe: ['vue'] }, optimizeDeps: { exclude: [...catalog.packages.keys()] } }
    },
    resolveId(id, importer) {
      return resolveWorkspaceSource(catalog, id, importer)
    },
    configureServer(server) {
      const manifests = new Set(catalog.workspaces.map((entry) => resolve(entry.path, 'package.json')))
      const workspace = resolve(root, 'pnpm-workspace.yaml')
      const lock = resolve(root, 'pnpm-lock.yaml')
      const changed = (_event, file) => {
        if (file !== workspace && file !== lock && !manifests.has(file) && !file.endsWith(`${sep}package.json`)) {
          return
        }
        clearTimeout(timer)
        timer = setTimeout(() => {
          // Restart refreshes dependency optimization and rescans newly created workspace packages.
          void server.restart().catch((error) => server.config.logger.error(error.message))
        }, 150)
      }
      server.watcher.add([workspace, lock, ...catalog.patterns.filter((pattern) => pattern.includes('*')).map((pattern) => resolve(root, pattern.split('*')[0])), ...manifests])
      server.watcher.on('all', changed)
      cleanup = () => {
        clearTimeout(timer)
        server.watcher.off('all', changed)
      }
    },
    closeBundle() {
      cleanup()
      catalog = { ...catalog, packages: new Map() }
    },
  }
}
