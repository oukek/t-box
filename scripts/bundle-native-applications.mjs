import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBuildFiles, discoverApplications, sha256 } from './application-builds.mjs'

/** Native-only signed assets, outside Capacitor's web root and native bridge origin. */
export async function bundleNativeApplications(root) {
  const target = join(root, 'capacitor/bundled-applications')
  const staging = target + '.tmp'
  const applications = []
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    for (const config of (await discoverApplications(root)).filter((config) => config.native?.bundled)) {
      const release = (await import(pathToFileURL(join(root, 'apps', config.appId, config.releaseModule)).href))[config.releaseExport]
      if (release?.appId !== config.appId || release.manifest?.id !== config.appId || release.protocol !== 1 || release.kind !== 'system' || !release.defaultInstalled || release.runtime?.type !== 'web' || !release.platforms.includes('ios') || !release.platforms.includes('android')) {
        throw new Error(`Only default installed native system applications may be bundled: ${config.appId}`)
      }
      const { files, artifact: digest } = await collectBuildFiles(join(root, 'apps', config.appId, 'web/dist'))
      if (files.some((file) => file.path === 'tbox-package-files.json' || file.path.split('/').some((part) => part.startsWith('.')))) {
        throw new Error('Application build uses a reserved native package file')
      }
      const base = join(staging, config.appId, digest)
      const hashes = Object.fromEntries(files.map((file) => [file.path, sha256(Buffer.from(file.content, 'base64'))]))
      // collectBuildFiles already sorts and validates paths and sizes; preserve exact canonical hash order.
      for (const file of files) {
        const data = Buffer.from(file.content, 'base64')
        await mkdir(join(base, file.path, '..'), { recursive: true })
        await writeFile(join(base, file.path), data)
      }
      await writeFile(join(base, 'tbox-package-files.json'), JSON.stringify(hashes))
      applications.push({
        ...release,
        releaseId: `${config.appId}-bundled-${release.manifest.version}-${digest.slice(0, 12)}`,
        runtime: { type: 'web', entryUrl: `https://bundled.tbox.invalid/${config.appId}/${digest}/`, integrity: `sha256-${digest}` },
      })
    }
    if (!applications.length) {
      throw new Error('No native system applications were selected')
    }
    await writeFile(join(staging, 'index.json'), JSON.stringify({ protocol: 1, applications }))
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
    console.info(`Bundled native applications: ${applications.map((release) => `${release.appId}@${release.manifest.version}`).join(', ')}`)
    return applications
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await bundleNativeApplications(fileURLToPath(new URL('..', import.meta.url)))
}
