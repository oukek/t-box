import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// No database, credentials, or model requests. Exercise production workspace entries.
const api = await realpath(fileURLToPath(new URL('.', import.meta.url)))
const pkg = JSON.parse(await readFile(join(api, 'package.json'), 'utf8'))
for (const name of Object.keys(pkg.dependencies).filter((name) => name.startsWith('@t-box/'))) {
  await import(name)
  const dependency = await realpath(join(api, 'node_modules', name))
  if (!dependency.startsWith(api + '/')) {
    throw new Error(`Workspace dependency escaped deployment: ${name}`)
  }
}
await import('./dist/db/data-source.js')
await import('./dist/chat/provider.js')
await import('./dist/resources/service.js')
await import('./dist/app.js')
process.stdout.write('Production modules and isolated workspace dependencies verified.\n')
