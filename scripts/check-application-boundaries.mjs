import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const errors = []
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(entry.name)) {
      continue
    }
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await files(path)))
    } else if (['.ts', '.vue', '.css'].includes(extname(path))) {
      result.push(path)
    }
  }
  return result
}
const packages = []
for (const app of await readdir(resolve(root, 'apps'))) {
  for (const layer of ['contracts', 'web', 'server', 'shell']) {
    const path = resolve(root, 'apps', app, layer)
    try {
      await access(resolve(path, 'package.json'))
      packages.push({ path, layer })
    } catch {}
  }
}
for (const name of [
  'ui-kit',
  'app-shell-sdk',
  'app-sdk',
  'app-server-sdk',
  'app-web-sdk',
  'app-contracts',
  'server-foundation',
  'dayjs',
  'device-reminders',
]) {
  packages.push({ path: resolve(root, 'packages', name), layer: 'sdk' })
}
for (const { path, layer } of packages) {
  const manifest = JSON.parse(
    await readFile(resolve(path, 'package.json'), 'utf8'),
  )
  const dependencies = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
    ...Object.keys(manifest.peerDependencies || {}),
  ])
  for (const file of await files(resolve(path, 'src'))) {
    const source = await readFile(file, 'utf8')
    const pattern =
      /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s*|@import\s*)["']([^"']+)["']/g
    for (const match of source.matchAll(pattern)) {
      const ref = match[1]
      const label = `${relative(root, file)} → ${ref}`
      if (ref.startsWith('.')) {
        const target = resolve(dirname(file), ref)
        if (!target.startsWith(`${path}/src/`)) {
          errors.push(`Relative import leaves its package: ${label}`)
        }
        const candidates = [
          target,
          `${target}.ts`,
          `${target}.vue`,
          `${target}/index.ts`,
          target.replace(/\.js$/, '.ts'),
        ]
        if (
          !(
            await Promise.all(
              candidates.map((p) =>
                access(p).then(
                  () => true,
                  () => false,
                ),
              ),
            )
          ).some(Boolean)
        ) {
          errors.push(`Missing source import: ${label}`)
        }
      } else if (!ref.startsWith('node:')) {
        const name = ref.startsWith('@')
          ? ref.split('/').slice(0, 2).join('/')
          : ref.split('/')[0]
        if (!dependencies.has(name)) {
          errors.push(`Undeclared dependency: ${label}`)
        }
        if (layer === 'contracts' && /-(?:web|server)(?:\/|$)/.test(name)) {
          errors.push(`Contracts depend on runtime: ${label}`)
        }
        if (layer === 'server' && /-web(?:\/|$)/.test(name)) {
          errors.push(`Server depends on browser code: ${label}`)
        }
        if (['web', 'shell'].includes(layer) && /-server(?:\/|$)/.test(name)) {
          errors.push(`Browser depends on server code: ${label}`)
        }
        if (
          ['ui-kit', 'server-foundation', 'dayjs', 'app-contracts'].some(
            (n) => manifest.name === `@t-box/${n}`,
          ) &&
          /^@t-box\/.+-(?:contracts|web|server)$/.test(name) &&
          name !== '@t-box/app-contracts'
        ) {
          errors.push(`Common package depends on an application: ${label}`)
        }
      }
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Application boundaries verified (${packages.length} packages).`)
}
