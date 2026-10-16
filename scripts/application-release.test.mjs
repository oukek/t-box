import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBuildFiles, discoverApplications, sha256, validVersion, workflowOptions } from './application-builds.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
test('only apps with validated independent Web builds appear in the generated choices', async () => {
  const applications = await discoverApplications(root)
  assert.ok(applications.length > 0)
  assert.ok(applications.every((a) => a.appId && a.package && a.releaseModule))
  const workflow = await readFile(join(root, '.github/workflows/application-release.yml'), 'utf8')
  assert.equal(workflowOptions(workflow, applications), workflow)
  const generated = workflowOptions(workflow, [...applications, { appId: 'test-app' }])
  assert.ok(generated.includes('          - test-app\n'))
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
    await writeFile(join(independent, 'web/index.html'), '<html></html>')
    assert.deepEqual((await discoverApplications(directory)).map((v) => v.appId), ['example'])
    await rm(join(independent, 'web/index.html'))
    await assert.rejects(discoverApplications(directory))
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

for (const failBundle of [false, true]) {
  test(failBundle ? 'failed public bundle upload never calls the import API' : 'one public applications bucket serves static files and the unsigned bundle; submission retries without publishing', async () => {
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
const calls = []
globalThis.fetch = async (url, options) => {
  if (options.method !== 'POST') return new Response(readFileSync(join(process.env.FAKE_OSS_DIR, new URL(url).pathname)))
  if (!existsSync(join(process.env.FAKE_OSS_DIR, 'calculator', process.env.ARTIFACT, 'artifact.json'))) throw new Error('Submission before static publication')
  const body = JSON.parse(options.body)
  const bundleUrl = new URL(body.url)
  if (bundleUrl.origin !== 'https://tboxos-app.oss-cn-hangzhou.aliyuncs.com' || bundleUrl.search) throw new Error('Expected public unsigned URL in applications bucket')
  const bundle = JSON.parse(readFileSync(join(process.env.FAKE_OSS_DIR, bundleUrl.pathname), 'utf8'))
  if (bundle.artifact !== process.env.ARTIFACT) throw new Error('Missing public build bundle')
  calls.push({ url: String(url), body, method: options.method })
  writeFileSync(process.env.TRACE, JSON.stringify(calls))
  if (calls.length === 1) throw new Error('Connection lost after server commit')
  return new Response(JSON.stringify({ data: { releaseId: 'test-release', revision: 1, status: 'submitted' } }), { status: 201 })
}
`)
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, join(root, 'scripts/submit-application-release.mjs'), 'calculator', '1.2.3'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: bin + ':' + process.env.PATH,
          APP_RELEASE_OUTPUT: join(directory, 'releases'),
          OSS_BUCKET: 'obsolete-private-bucket-must-be-ignored',
          OSS_REGION: 'cn-hangzhou',
          OSS_ACCESS_KEY_ID: 'fixture-key-id',
          OSS_ACCESS_KEY_SECRET: 'fixture-key-secret',
          OSS_ENDPOINT: '',
          APP_OSS_PREFIX: '',
          APP_IMPORT_TOKEN: 'tbox_build_' + 'a'.repeat(43),
          APP_IMPORT_API_URL: 'https://api.example.com/api/v1/application-builds',
          GITHUB_REPOSITORY: 'test/repo',
          GITHUB_SHA: 'a'.repeat(40),
          GITHUB_RUN_ID: '123',
          TRACE: trace,
          OSS_TRACE: join(directory, 'oss-trace.jsonl'),
          FAIL_BUNDLE: String(failBundle),
          PM2_SSH_PASSWORD: 'must-not-reach-ossutil',
          FAKE_OSS_DIR: join(directory, 'public'),
          APPS_OSS_BUCKET: 'tboxos-app',
          APP_ARTIFACT_ORIGIN: 'https://apps.example.com',
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
      assert.equal(result.status, 0, result.stderr)
      const calls = JSON.parse(await readFile(trace, 'utf8'))
      assert.equal(calls.length, 2)
      assert.deepEqual(calls[0], calls[1])
      assert.equal(calls[0].url, 'https://api.example.com/api/v1/application-builds')
      assert.equal(calls[0].body.url, `https://tboxos-app.oss-cn-hangzhou.aliyuncs.com/builds/calculator/1.2.3/${digest}.json`)
      assert.ok(result.stdout.includes('status submitted'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
