import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deploymentEnvironment } from '../deploy/settings.mjs'
import { applicationChoice, collectBuildFiles, discoverApplications, selectApplication, sha256, validVersion, workflowOptions } from './application-builds.mjs'
import { packApplicationRelease } from './pack-application-release.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
test('only apps with validated independent Web builds appear in the generated choices', async () => {
  const applications = await discoverApplications(root)
  assert.ok(applications.length > 0)
  assert.ok(applications.every((a) => a.appId && a.package && a.releaseModule))
  const workflow = await readFile(join(root, '.github/workflows/application-release.yml'), 'utf8')
  assert.equal(workflowOptions(workflow, applications), workflow)
  const generated = workflowOptions(workflow, [...applications, { appId: 'test-app', title: '测试应用' }])
  assert.ok(generated.includes('          - \'测试应用 (test-app)\'\n'))
  const ledger = applications.find((app) => app.appId === 'ledger')
  assert.equal(applicationChoice(ledger), '记账 (ledger)')
  assert.equal(selectApplication(applications, '记账 (ledger)'), ledger)
  assert.equal(selectApplication(applications, 'ledger'), ledger)
  assert.throws(() => selectApplication(applications, '计算器 (ledger)'))
  assert.ok(!workflow.includes('inputs.version'))
  assert.ok(!workflow.includes('inputs.release_notes'))
  assert.ok(workflow.includes('"$APPLICATION_SELECTION"'))
  assert.throws(() => workflowOptions(workflow, []))
  assert.ok(!/^\s+(?:push|pull_request|schedule):/m.test(workflow))
  assert.ok(workflow.includes('workflow_dispatch:'))
})

test('bundle digest is deterministic and symlinks/missing entrypoints are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tbox-app-build-'))
  try {
    await mkdir(join(directory, 'assets'))
    await writeFile(join(directory, 'index.html'), '<html>test</html>')
    await writeFile(join(directory, 'assets/app.js'), 'console.log(1)')
    const first = await collectBuildFiles(directory)
    const second = await collectBuildFiles(directory)
    assert.deepEqual(first, second)
    assert.equal(first.artifact, sha256(JSON.stringify(Object.fromEntries(first.files.map((v) => [v.path, sha256(Buffer.from(v.content, 'base64'))])))))
    await symlink(join(directory, 'index.html'), join(directory, 'link.html'))
    await assert.rejects(collectBuildFiles(directory), /symlinks/)
    await rm(join(directory, 'link.html'))
    await rm(join(directory, 'index.html'))
    await assert.rejects(collectBuildFiles(directory), /index.html/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('discovery skips source-only apps and accepts a frontend-only release declaration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tbox-app-discovery-'))
  try {
    await mkdir(join(directory, 'apps/source-only/web'), { recursive: true })
    const independent = join(directory, 'apps/example')
    await mkdir(join(independent, 'web'), { recursive: true })
    await mkdir(join(independent, 'contracts'), { recursive: true })
    await writeFile(join(independent, 'build.config.json'), JSON.stringify({
      appId: 'example',
      package: '@t-box/example-web',
      releasePackage: '@t-box/example-contracts',
      releaseModule: 'contracts/dist/release.js',
      releaseExport: 'exampleRelease',
    }))
    await writeFile(join(independent, 'web/package.json'), JSON.stringify({ name: '@t-box/example-web', scripts: { build: 'vite build' } }))
    await writeFile(join(independent, 'contracts/package.json'), JSON.stringify({ name: '@t-box/example-contracts', scripts: { build: 'tsc' } }))
    await writeFile(join(independent, 'web/index.html'), '<html><title>示例应用</title></html>')
    assert.deepEqual((await discoverApplications(directory)).map((v) => v.appId), ['example'])
    await rm(join(independent, 'web/index.html'))
    await assert.rejects(discoverApplications(directory))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('packaging resolves the Chinese choice, reads manifest.version and leaves release copy to administrators', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tbox-app-manifest-release-'))
  try {
    const app = join(directory, 'apps/example')
    await mkdir(join(app, 'web/dist'), { recursive: true })
    await mkdir(join(app, 'contracts/dist'), { recursive: true })
    await mkdir(join(directory, 'bin'))
    await writeFile(join(app, 'build.config.json'), JSON.stringify({ appId: 'example', package: '@t-box/example-web', releasePackage: '@t-box/example-contracts', releaseModule: 'contracts/dist/release.js', releaseExport: 'release' }))
    await writeFile(join(app, 'web/package.json'), JSON.stringify({ name: '@t-box/example-web', scripts: { build: 'fixture' } }))
    await writeFile(join(app, 'contracts/package.json'), JSON.stringify({ type: 'module', name: '@t-box/example-contracts', scripts: { build: 'fixture' } }))
    await writeFile(join(app, 'web/index.html'), '<title>示例应用</title>')
    await writeFile(join(app, 'web/dist/index.html'), '<title>Built application</title>')
    const release = { appId: 'example', manifest: { id: 'example', version: '2.3.4-beta.1', name: '示例应用' }, runtime: { type: 'web' }, kind: 'user', updatePrompt: { mode: 'custom', title: 'Must be configured in admin' } }
    await writeFile(join(app, 'contracts/dist/release.js'), `export const release = ${JSON.stringify(release)}\n`)
    await writeFile(join(directory, 'bin/pnpm'), '#!/bin/sh\n[ "$1" = "-r" ] && [ "$3" = "@t-box/example-web..." ] && [ "$5" = "@t-box/example-contracts..." ]\n', { mode: 0o755 })
    const envFile = join(directory, 'github.env')
    const workflow = await readFile(join(root, '.github/workflows/application-release.yml'), 'utf8')
    const initializeOutput = /^ {6}- name: 初始化应用发布输出目录\n {8}run: (.+)$/m.exec(workflow)?.[1]
    assert.ok(initializeOutput)
    const initialized = spawnSync('bash', ['-e', '-c', initializeOutput], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: join(directory, 'runner temp'), GITHUB_ENV: envFile },
    })
    assert.equal(initialized.status, 0, initialized.stderr)
    const exported = await readFile(envFile, 'utf8')
    const runnerEnvironment = Object.fromEntries(exported.trim().split('\n').map((line) => line.split('=')))
    assert.equal(runnerEnvironment.APP_RELEASE_OUTPUT, join(directory, 'runner temp/application-releases'))
    const metadata = await packApplicationRelease(directory, '示例应用 (example)', {
      ...process.env,
      ...runnerEnvironment,
      PATH: join(directory, 'bin') + ':' + process.env.PATH,
      GITHUB_ENV: envFile,
      APP_RELEASE_NOTES: 'Legacy build input must be ignored',
    })
    assert.equal(metadata.version, release.manifest.version)
    const bundle = JSON.parse(await readFile(join(runnerEnvironment.APP_RELEASE_OUTPUT, 'example', metadata.version, metadata.file), 'utf8'))
    assert.equal(bundle.version, release.manifest.version)
    assert.equal(bundle.releaseNotes, '')
    assert.equal(bundle.publication.updatePrompt, undefined)
    assert.equal(await readFile(envFile, 'utf8'), exported + 'APPLICATION=example\nVERSION=2.3.4-beta.1\n')
    const rejected = spawnSync(process.execPath, [join(root, 'scripts/pack-application-release.mjs'), 'example', '9.9.9'], { encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /version is read from manifest.version/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('release versions reject paths and shell interpolation', () => {
  for (const value of ['1.0.1', '12.3.4-beta.2']) {
    assert.ok(validVersion(value))
  }
  for (const value of ['../x', '1.0.0;whoami', '01.0.0', '1.0', '$(whoami)']) {
    assert.ok(!validVersion(value))
  }
})

for (const scenario of [
  { name: 'one public applications bucket serves static files and the unsigned bundle; submission retries without publishing', failure: 'connection', attempts: 2 },
  { name: 'an interrupted successful import response retries the same submission without reuploading', failure: 'response-body', attempts: 2 },
  { name: 'a temporary server failure retries the same import request', failure: 'unavailable', attempts: 2 },
  { name: 'a rate-limited import retries the same request', failure: 'rate-limit', attempts: 2 },
  { name: 'an import permission failure with a non-JSON body never retries', failure: 'forbidden', attempts: 1, error: /Server rejected build \(403\)/ },
  { name: 'an import permission failure with a null JSON body never retries', failure: 'forbidden-null', attempts: 1, error: /Server rejected build \(403\)/ },
  { name: 'a version conflict never retries or reports a successful submission', failure: 'conflict', attempts: 1, error: /Server rejected build \(409\)/ },
  { name: 'an invalid import response never reports a successful submission', failure: 'invalid-response', attempts: 1, error: /Unexpected import response/ },
  { name: 'a null import response fails immediately as an invalid response', failure: 'null-response', attempts: 1, error: /Unexpected import response/ },
  { name: 'repeated network failures stop after five submissions without reuploading', failure: 'exhausted', attempts: 5, error: /Build submission failed after retries/ },
  { name: 'failed public bundle upload never calls the import API', failBundle: true },
]) {
  test(scenario.name, async () => {
    const failBundle = Boolean(scenario.failBundle)
    const directory = await mkdtemp(join(tmpdir(), 'tbox-app-submit-'))
    try {
      const releaseDir = join(directory, 'releases/calculator/1.2.3')
      await mkdir(releaseDir, { recursive: true })
      const files = [{ path: 'index.html', content: Buffer.from('fixture').toString('base64') }]
      const artifact = sha256(JSON.stringify({ 'index.html': sha256('fixture') }))
      const bundle = Buffer.from(JSON.stringify({ protocol: 1, appId: 'calculator', version: '1.2.3', artifact, files }))
      const digest = sha256(bundle)
      await writeFile(join(releaseDir, digest + '.json'), bundle)
      await writeFile(join(releaseDir, 'release.json'), JSON.stringify({ appId: 'calculator', version: '1.2.3', artifact, sha256: digest, file: digest + '.json' }))
      const bin = join(directory, 'bin')
      await mkdir(bin)
      const oss = join(bin, 'ossutil')
      await writeFile(oss, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
if (args[0] !== 'cp' || !args[2].startsWith('oss://tboxos-app/')) process.exit(2)
if (process.env.APP_IMPORT_TOKEN || process.env.PM2_SSH_PASSWORD) process.exit(3)
fs.appendFileSync(process.env.OSS_TRACE, JSON.stringify(args) + '\\n')
if (args[2].includes('/builds/')) {
  if (args[args.indexOf('--acl') + 1] !== 'public-read') process.exit(4)
  if (process.env.FAIL_BUNDLE === 'true') process.exit(5)
}
if (args[0] === 'cp') {
  const target = path.join(process.env.FAKE_OSS_DIR, new URL(args[2]).pathname)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(args[1], target)
}
`, { mode: 0o755 })
      const trace = join(directory, 'trace.json')
      const mock = join(directory, 'mock.mjs')
      await writeFile(mock, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as schedule } from 'node:timers'
const calls = []
const delays = []
const save = () => writeFileSync(process.env.TRACE, JSON.stringify({ calls, delays }))
globalThis.setTimeout = (callback, delay, ...args) => {
  delays.push(delay)
  save()
  return schedule(callback, 0, ...args)
}
globalThis.fetch = async (url, options) => {
  if (options.method !== 'POST') return new Response(readFileSync(join(process.env.FAKE_OSS_DIR, new URL(url).pathname)))
  if (options.headers.authorization !== 'Bearer ' + 'a'.repeat(64)) throw new Error('Missing scoped import authorization')
  if (!existsSync(join(process.env.FAKE_OSS_DIR, 'calculator', process.env.ARTIFACT, 'artifact.json'))) throw new Error('Submission before static publication')
  const body = JSON.parse(options.body)
  const bundleUrl = new URL(body.url)
  if (bundleUrl.origin !== 'https://tboxos-app.oss-cn-hangzhou.aliyuncs.com' || bundleUrl.search) throw new Error('Expected public unsigned URL in applications bucket')
  const bundle = JSON.parse(readFileSync(join(process.env.FAKE_OSS_DIR, bundleUrl.pathname), 'utf8'))
  if (bundle.artifact !== process.env.ARTIFACT) throw new Error('Missing public build bundle')
  calls.push({ url: String(url), body, method: options.method })
  save()
  const failure = process.env.SUBMISSION_FAILURE
  if (failure === 'forbidden') return new Response('Forbidden', { status: 403 })
  if (failure === 'forbidden-null') return new Response('null', { status: 403 })
  if (failure === 'conflict') return new Response(JSON.stringify({ error: { code: 'APP_VERSION_CONFLICT' } }), { status: 409 })
  if (failure === 'invalid-response') return new Response('{}', { status: 201 })
  if (failure === 'null-response') return new Response('null', { status: 201 })
  if (failure === 'exhausted' || (failure === 'connection' && calls.length === 1)) throw new Error('Connection lost after server commit')
  if (calls.length === 1) {
    if (failure === 'response-body') return new Response(new ReadableStream({ start(controller) { controller.error(new Error('Connection lost while reading import response')) } }), { status: 201 })
    if (failure === 'unavailable') return new Response('Upstream unavailable', { status: 503 })
    if (failure === 'rate-limit') return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429 })
  }
  return new Response(JSON.stringify({ data: { releaseId: 'test-release', revision: 1, status: 'submitted' } }), { status: 201 })
}
`)
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, join(root, 'scripts/submit-application-release.mjs'), 'calculator', '1.2.3'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...deploymentEnvironment({ DEPLOY_DOMAIN: 'example.com', OSS_REGION: 'cn-hangzhou' }),
          PATH: bin + ':' + process.env.PATH,
          APP_RELEASE_OUTPUT: join(directory, 'releases'),
          OSS_BUCKET: 'obsolete-private-bucket-must-be-ignored',
          OSS_ACCESS_KEY_ID: 'fixture-key-id',
          OSS_ACCESS_KEY_SECRET: 'fixture-key-secret',
          APP_IMPORT_TOKEN: 'a'.repeat(64),
          GITHUB_REPOSITORY: 'test/repo',
          GITHUB_SHA: 'a'.repeat(40),
          GITHUB_RUN_ID: '123',
          TRACE: trace,
          OSS_TRACE: join(directory, 'oss-trace.jsonl'),
          FAIL_BUNDLE: String(failBundle),
          SUBMISSION_FAILURE: scenario.failure,
          PM2_SSH_PASSWORD: 'must-not-reach-ossutil',
          FAKE_OSS_DIR: join(directory, 'public'),
          ARTIFACT: artifact,
        },
      })
      const uploads = (await readFile(join(directory, 'oss-trace.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
      assert.equal(uploads.length, 3)
      assert.equal(uploads.at(-1)[2], `oss://tboxos-app/builds/calculator/1.2.3/${digest}.json`)
      if (failBundle) {
        assert.notEqual(result.status, 0)
        await assert.rejects(readFile(trace), { code: 'ENOENT' })
        return
      }
      const { calls, delays } = JSON.parse(await readFile(trace, 'utf8'))
      assert.equal(calls.length, scenario.attempts)
      assert.deepEqual(delays, Array.from({ length: scenario.attempts - 1 }, (_, index) => 1000 * 2 ** index))
      for (const call of calls) {
        assert.deepEqual(call, calls[0])
      }
      assert.equal(calls[0].url, 'https://api.example.com/api/v1/application-builds')
      assert.equal(calls[0].body.url, `https://tboxos-app.oss-cn-hangzhou.aliyuncs.com/builds/calculator/1.2.3/${digest}.json`)
      if (scenario.error) {
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, scenario.error)
        assert.ok(!result.stdout.includes('Build registered:'))
        return
      }
      assert.equal(result.status, 0, result.stderr)
      assert.ok(result.stdout.includes('status submitted'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
