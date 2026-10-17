import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Only small trusted deployment metadata is shipped with the API, never static application bytes. */
export async function applicationBootstrap(root) {
  const result = {}
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9_-]{0,63}$/.test(entry.name)) {
      continue
    }
    const digests = (await readdir(join(root, entry.name))).filter((digest) => /^[a-f0-9]{64}$/.test(digest))
    if (digests.length !== 1) {
      throw new Error('Expected one bootstrap artifact: ' + entry.name)
    }
    const digest = digests[0]
    const manifest = JSON.parse(await readFile(join(root, entry.name, digest, 'artifact.json'), 'utf8'))
    if (manifest.protocol !== 1 || manifest.appId !== entry.name || manifest.digest !== digest || createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex') !== digest) {
      throw new Error('Invalid bootstrap artifact metadata: ' + entry.name)
    }
    result[entry.name] = digest
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    throw new Error('Usage: node scripts/application-bootstrap.mjs ARTIFACT_ROOT OUTPUT_JSON')
  }
  await writeFile(process.argv[3], JSON.stringify(await applicationBootstrap(process.argv[2]), null, 2) + '\n', { flag: 'wx' })
}
