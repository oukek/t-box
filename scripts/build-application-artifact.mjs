import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const appId = process.argv[2]
if (!/^[a-z][a-z0-9_-]{0,63}$/.test(appId || '')) {
  throw new Error('Provide a registered app id')
}
const source = join(root, 'apps', appId, 'web', 'dist')
const files = {}
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) {
      await scan(file)
    } else if (entry.isFile()) {
      files[relative(source, file).replaceAll('\\', '/')] = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
    } else {
      throw new Error('Artifacts cannot contain symlinks')
    }
  }
}
await scan(source)
const sorted = Object.fromEntries(
  Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
)
const digest = createHash('sha256')
  .update(JSON.stringify(sorted))
  .digest('hex')
const target = join(root, 'output', 'app-artifacts', appId, digest)
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true, errorOnExist: false })
await writeFile(
  join(target, 'artifact.json'),
  JSON.stringify({ protocol: 1, appId, digest, files: sorted }, null, 2) + '\n',
)
console.info(`Application artifact: ${appId}/${digest}`)
