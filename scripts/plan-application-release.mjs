import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverApplications, selectApplications } from './application-builds.mjs'

export async function planApplicationRelease(root, selection, environment = process.env) {
  const applications = selectApplications(await discoverApplications(root), selection).map((app) => app.appId)
  if (environment.GITHUB_OUTPUT) {
    await appendFile(environment.GITHUB_OUTPUT, 'applications=' + JSON.stringify(applications) + '\n')
  }
  console.info('Selected applications: ' + applications.join(', '))
  return applications
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/plan-application-release.mjs <application|all>')
  }
  await planApplicationRelease(fileURLToPath(new URL('..', import.meta.url)), process.argv[2])
}
