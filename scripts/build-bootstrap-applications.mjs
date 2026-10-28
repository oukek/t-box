import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBuildFiles, discoverApplications, sha256 } from './application-builds.mjs'

/** Build every declared application and snapshot only its current artifact, including user apps. */
export async function buildBootstrapApplications(root, output, run = execFileSync) {
  const applications = await discoverApplications(root)
  if (!applications.length) {
    throw new Error('No independently buildable applications found')
  }
  await mkdir(output, { recursive: false })
  run('pnpm', ['-r', ...applications.flatMap((app) => ['--filter', app.package + '...']), '--if-present', 'build'], { cwd: root, stdio: 'inherit' })
  const bootstrap = {}
  for (const { appId } of applications) {
    const { files, artifact: digest } = await collectBuildFiles(join(root, 'apps', appId, 'web/dist'))
    const directory = join(output, appId, digest)
    const hashes = {}
    for (const file of files) {
      const bytes = Buffer.from(file.content, 'base64')
      await mkdir(join(directory, file.path, '..'), { recursive: true })
      await writeFile(join(directory, file.path), bytes)
      hashes[file.path] = sha256(bytes)
    }
    await writeFile(join(directory, 'artifact.json'), JSON.stringify({ protocol: 1, appId, digest, files: hashes }, null, 2) + '\n')
    bootstrap[appId] = digest
  }
  return bootstrap
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/build-bootstrap-applications.mjs NEW_OUTPUT_DIRECTORY')
  }
  await buildBootstrapApplications(fileURLToPath(new URL('../', import.meta.url)), resolve(process.argv[2]))
}
