import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const output = resolve('../../output/collector-releases')
await mkdir(output, { recursive: true })
await rm(`${output}/tark-collector-${version}.zip`, { force: true })
execFileSync('zip', ['-qr', `${output}/tark-collector-${version}.zip`, '.'], {
  cwd: 'dist',
})
process.stdout.write(`${output}/tark-collector-${version}.zip\n`)
