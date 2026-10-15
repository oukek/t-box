import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const origin = new URL(process.env.APP_ARTIFACT_ORIGIN || '')
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('APP_ARTIFACT_ORIGIN must be a separate HTTPS origin, e.g. https://apps.example.com')
}
const root = fileURLToPath(new URL('../', import.meta.url))
const seedRoot = join(root, 'bootstrap/app-artifacts')
for (const entry of await readdir(seedRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-z][a-z0-9_-]{0,63}$/.test(entry.name)) {
    continue
  }
  const appId = entry.name
  const seed = join(seedRoot, appId)
  const configDir = join(root, 'apps', appId)
  await mkdir(configDir, { recursive: true })
  try {
    await readFile(join(configDir, 'deployment.local.json'))
    process.stdout.write('Existing ' + appId + ' deployment preserved; update applications through publishing.\n')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    const digests = (await readdir(seed)).filter((name) => /^[a-f0-9]{64}$/.test(name))
    if (digests.length !== 1) {
      throw new Error('Application bootstrap must have exactly one artifact: ' + appId)
    }
    const digest = digests[0]
    const target = join(root, 'output/app-artifacts', appId, digest)
    await mkdir(target, { recursive: true })
    await cp(join(seed, digest), target, { recursive: true })
    await writeFile(join(configDir, 'deployment.local.json'), JSON.stringify({ origin: origin.origin, artifact: digest }, null, 2) + '\n', { flag: 'wx' })
    process.stdout.write(appId + ' initialized: ' + digest + '\n')
  }
}
