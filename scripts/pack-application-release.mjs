import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBuildFiles, discoverApplications, sha256, validVersion } from './application-builds.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const appId = process.argv[2]
const version = process.argv[3]
if (!validVersion(version)) {
  throw new Error('Provide a release version such as 1.0.1')
}
const config = (await discoverApplications(root)).find((v) => v.appId === appId)
if (!config) {
  throw new Error('Application is not independently buildable; add and validate build.config.json first')
}
const result = spawnSync('pnpm', ['-r', '--filter', config.package + '...', '--filter', config.releasePackage + '...', '--if-present', 'build'], { cwd: root, stdio: 'inherit' })
if (result.error || result.status !== 0) {
  throw new Error('Application build failed', { cause: result.error })
}
const release = (await import(pathToFileURL(join(root, 'apps', appId, config.releaseModule)).href))[config.releaseExport]
if (release?.appId !== appId || release.runtime?.type !== 'web') {
  throw new Error('Build declaration does not point to an independent Web release')
}
const collected = await collectBuildFiles(join(root, 'apps', appId, 'web/dist'))
const { name, description, icon, iconAsset, iconVariant, color } = release.manifest
const notes = process.env.APP_RELEASE_NOTES || ''
if (notes.length > 4000) {
  throw new Error('Release notes exceed 4000 characters')
}
const bundle = Buffer.from(JSON.stringify({
  protocol: 1,
  appId,
  version,
  ...collected,
  publication: { kind: release.kind, name, description, icon, iconAsset, iconVariant, color },
  releaseNotes: notes,
}))
if (bundle.length > 30 * 1024 * 1024) {
  throw new Error('Release bundle exceeds 30 MB')
}
const digest = sha256(bundle)
const target = resolve(process.env.APP_RELEASE_OUTPUT || join(root, 'output/application-releases'), appId, version)
await mkdir(target, { recursive: true })
await writeFile(join(target, digest + '.json'), bundle)
await writeFile(join(target, 'release.json'), JSON.stringify({ protocol: 1, appId, version, sha256: digest, artifact: collected.artifact, file: digest + '.json' }, null, 2) + '\n')
console.info(`Application release packaged: ${appId} ${version} (${digest})\n${target}`)
