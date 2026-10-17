import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBuildFiles, discoverApplications, selectApplication, sha256, validVersion } from './application-builds.mjs'

export async function packApplicationRelease(root, selection, environment = process.env) {
  const config = selectApplication(await discoverApplications(root), selection)
  const { appId } = config
  const result = spawnSync('pnpm', ['-r', '--filter', config.package + '...', '--filter', config.releasePackage + '...', '--if-present', 'build'], { cwd: root, stdio: 'inherit', env: environment })
  if (result.error || result.status !== 0) {
    throw new Error('Application build failed', { cause: result.error })
  }
  const release = (await import(pathToFileURL(join(root, 'apps', appId, config.releaseModule)).href))[config.releaseExport]
  if (release?.appId !== appId || release.runtime?.type !== 'web' || release.manifest?.id !== appId) {
    throw new Error('Build declaration does not point to an independent Web release')
  }
  const version = release.manifest.version
  if (!validVersion(version)) {
    throw new Error('Application manifest.version must be a valid release version such as 1.0.1')
  }
  const collected = await collectBuildFiles(join(root, 'apps', appId, 'web/dist'))
  const { name, description, icon, iconAsset, iconVariant, color } = release.manifest
  const bundle = Buffer.from(JSON.stringify({
    protocol: 1,
    appId,
    version,
    ...collected,
    publication: { kind: release.kind, name, description, icon, iconAsset, iconVariant, color },
    releaseNotes: '',
  }))
  if (bundle.length > 30 * 1024 * 1024) {
    throw new Error('Release bundle exceeds 30 MB')
  }
  const digest = sha256(bundle)
  const target = resolve(environment.APP_RELEASE_OUTPUT || join(root, 'output/application-releases'), appId, version)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, digest + '.json'), bundle)
  const metadata = { protocol: 1, appId, version, sha256: digest, artifact: collected.artifact, file: digest + '.json' }
  await writeFile(join(target, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
  if (environment.GITHUB_ENV) {
    await appendFile(environment.GITHUB_ENV, `APPLICATION=${appId}\nVERSION=${version}\n`)
  }
  console.info(`Application release packaged: ${appId} ${version} (${digest})\n${target}`)
  return metadata
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: pnpm pack:application <application>; version is read from manifest.version')
  }
  await packApplicationRelease(fileURLToPath(new URL('..', import.meta.url)), process.argv[2])
}
