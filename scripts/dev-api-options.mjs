import { dirname, sep } from 'node:path'

/** tsx waits for explicit includes before spawning; imported dependencies are registered asynchronously. */
export function apiWatchArguments(config, entry, paths) {
  const roots = new Set([dirname(entry)])
  const marker = `${sep}src${sep}`
  for (const targets of Object.values(paths)) {
    const source = targets[0]
    const index = source.lastIndexOf(marker)
    if (index >= 0) {
      roots.add(source.slice(0, index + marker.length - 1))
    }
  }
  return [
    'watch',
    '--clear-screen=false',
    ...[...roots].flatMap((root) => ['--include', root.split(sep).join('/') + '/**/*']),
    '--tsconfig',
    config,
    entry,
  ]
}
