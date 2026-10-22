import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverApplications, selectApplication } from './application-builds.mjs'
import { packApplicationRelease } from './pack-application-release.mjs'

/** Reuse the CI build format. Local submission never publishes or rewrites an installed release. */
export async function submitLocalApplications(root, selection, environment = process.env, run = spawnSync, pack = packApplicationRelease) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Local application submission is unavailable in production; use the application release workflow')
  }
  const applications = await discoverApplications(root)
  const selected = selection === 'all' ? applications : [selectApplication(applications, selection)]
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  for (const config of selected) {
    const metadata = await pack(root, config.appId, environment)
    const directory = resolve(environment.APP_RELEASE_OUTPUT || join(root, 'output/application-releases'), config.appId, metadata.version)
    const result = run(pnpm, ['--filter', '@t-box/api', 'exec', 'tsx', 'src/application-platform/submit-local-cli.ts', config.appId, join(directory, metadata.file)], { cwd: root, stdio: 'inherit', env: environment })
    if (result.error || result.status !== 0) {
      throw new Error(`Local submission failed: ${config.appId}. Earlier successful submissions remain unpublished.`, { cause: result.error })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: pnpm apps:submit:local <application id | all>. Builds and submits; publication remains manual.')
  }
  await submitLocalApplications(fileURLToPath(new URL('..', import.meta.url)), process.argv[2])
}
