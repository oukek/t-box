import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { discoverApplications, workflowOptions } from './application-builds.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const workflow = new URL('../.github/workflows/application-release.yml', import.meta.url)
const applications = await discoverApplications(root)
const contents = await readFile(workflow, 'utf8')
const generated = workflowOptions(contents, applications)
if (process.argv.includes('--check')) {
  if (contents !== generated) {
    throw new Error('Actions application choices are stale. Run pnpm apps:workflow and commit the workflow.')
  }
} else {
  await writeFile(workflow, generated)
}
console.info(`Independent application choices: ${applications.map((v) => v.appId).join(', ')}`)
