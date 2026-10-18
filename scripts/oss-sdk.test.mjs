import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { createOssClient, downloadOssObject, ossClientOptions, putOssObject } from '../deploy/oss/client.mjs'
import { ossTransferError } from '../deploy/oss/diagnostics.mjs'

const fixture = { OSS_REGION: 'cn-hangzhou', OSS_ACCESS_KEY_ID: 'fixture-id', OSS_ACCESS_KEY_SECRET: 'fixture-secret', APP_IMPORT_TOKEN: 'private-token', PM2_SSH_PASSWORD: 'private-password' }
const options = () => ossClientOptions('test-bucket', fixture)

test('SDK configuration contains only scoped credentials and validates public/internal endpoints', () => {
  const config = options()
  assert.equal(config.authorizationV4, true)
  assert.equal(config.secure, true)
  assert.equal(config.retryMax, 4)
  assert.equal(config.APP_IMPORT_TOKEN, undefined)
  assert.equal(config.PM2_SSH_PASSWORD, undefined)
  assert.equal(config.OSS_ACCESS_KEY_SECRET, undefined)
  const guangzhou = ossClientOptions('test-bucket', { ...fixture, OSS_REGION: 'cn-guangzhou' })
  assert.equal(guangzhou.region, 'oss-cn-guangzhou')
  assert.equal(guangzhou.endpoint, 'https://oss-cn-guangzhou.aliyuncs.com')
  assert.throws(() => ossClientOptions('test-bucket', { ...fixture, OSS_REGION: 'oss-cn-guangzhou' }))
  const internal = { ...fixture, OSS_ENDPOINT: 'https://oss-cn-hangzhou-internal.aliyuncs.com' }
  assert.throws(() => ossClientOptions('test-bucket', internal))
  assert.equal(ossClientOptions('test-bucket', internal, { allowInternal: true }).endpoint, internal.OSS_ENDPOINT)
  for (const endpoint of ['http://oss-cn-hangzhou.aliyuncs.com', 'https://evil.example', 'https://oss-cn-shenzhen.aliyuncs.com']) {
    assert.throws(() => ossClientOptions('test-bucket', { ...fixture, OSS_ENDPOINT: endpoint }, { allowInternal: true }))
  }
  for (const name of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_SESSION_TOKEN']) {
    assert.throws(() => ossClientOptions('test-bucket', { ...fixture, [name]: ' fixture-secret\n' }), (error) => {
      assert.ok(error.message.includes(name))
      assert.ok(!error.message.includes('fixture-secret'))
      return true
    })
  }
})

test('deployment diagnostics retain useful OSS fields without serializing credentials or signed requests', async () => {
  const secret = 'fixture-private-signature-and-key'
  const failure = Object.assign(new Error(`Access denied ${secret}`), {
    code: 'AccessDenied',
    status: 403,
    requestId: '0123456789ABCDEF01234567',
    ecCode: '0003-00000001',
    headers: { authorization: secret },
    request: { url: `https://bucket.example?Signature=${secret}` },
    cause: new Error(secret),
    accessKeySecret: secret,
  })
  const client = { options: options(), put: async () => {
    throw failure
  } }
  await assert.rejects(putOssObject(client, 'calendar/fixture/index.html', Buffer.from('fixture')), (error) => {
    for (const field of ['OSS upload failed', 'code=AccessDenied', 'HTTP=403', 'requestId=0123456789ABCDEF01234567', 'EC=0003-00000001', 'bucket=test-bucket', 'region=oss-cn-hangzhou', 'object=calendar/fixture/index.html', '阻止公共访问']) {
      assert.ok(error.message.includes(field), field)
    }
    assert.ok(!String(error.stack).includes(secret))
    assert.equal(error.cause, undefined)
    return true
  })
  const malicious = ossTransferError('upload', { code: secret, requestId: secret, ecCode: secret, status: secret }, client, 'fixture')
  assert.match(malicious.message, /code=UnknownError/)
  assert.ok(!malicious.message.includes(secret))
  const local = ossTransferError('upload', Object.assign(new Error(secret), { code: 'ENOENT' }), client, 'fixture')
  assert.match(local.message, /本地待上传文件/)
  const signing = ossTransferError('upload', { code: 'SignatureDoesNotMatch', status: 403 }, client, 'fixture')
  assert.match(signing.message, /同一对/)
})

test('actual SDK service error parsing preserves status, request ID and EC in safe upload diagnostics', async (t) => {
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(403, { 'content-type': 'application/xml' })
    response.end('<Error><Code>SignatureDoesNotMatch</Code><Message>fixture-secret must stay hidden</Message><RequestId>0123456789ABCDEF01234567</RequestId><EC>0002-00000040</EC></Error>')
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const client = createOssClient({ ...options(), endpoint: `http://127.0.0.1:${address.port}`, secure: false, cname: true, retryMax: 0 })
  await assert.rejects(putOssObject(client, 'fixture', Buffer.from('fixture')), (error) => {
    assert.match(error.message, /code=SignatureDoesNotMatch/)
    assert.match(error.message, /HTTP=403/)
    assert.match(error.message, /requestId=0123456789ABCDEF01234567/)
    assert.match(error.message, /EC=0002-00000040/)
    assert.ok(!String(error.stack).includes('fixture-secret'))
    return true
  })
})

test('the actual Alibaba SDK signs uploads and streams downloads against an isolated HTTP fixture', async (t) => {
  const objects = new Map()
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }
    requests.push({ method: request.method, url: request.url, headers: request.headers })
    if (request.method === 'PUT') {
      objects.set(request.url, Buffer.concat(chunks))
      response.writeHead(200, { 'etag': '"fixture"', 'x-oss-request-id': 'fixture-request' })
      response.end()
    } else {
      const bytes = objects.get(request.url)
      response.writeHead(bytes ? 200 : 404, { 'content-length': bytes?.length || 0 })
      response.end(bytes)
    }
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const client = createOssClient({ ...options(), endpoint: `http://127.0.0.1:${address.port}`, secure: false, cname: true, retryMax: 0 })
  const bytes = Buffer.from('SDK roundtrip fixture')
  await putOssObject(client, 'files/fixture.txt', bytes, { mime: 'text/plain', headers: { 'x-oss-object-acl': 'public-read', 'Cache-Control': 'no-cache' } })
  const directory = await mkdtemp(join(tmpdir(), 'tbox-sdk-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = join(directory, 'download')
  await downloadOssObject(client, 'files/fixture.txt', target, bytes.length)
  assert.deepEqual(await readFile(target), bytes)
  assert.deepEqual(requests.map(({ method }) => method), ['PUT', 'GET'])
  assert.match(requests[0].headers.authorization, /^OSS4-HMAC-SHA256 /)
  assert.equal(requests[0].headers['content-md5'], createHash('md5').update(bytes).digest('base64'))
  assert.equal(requests[0].headers['x-oss-object-acl'], 'public-read')
  assert.equal(requests[0].headers['cache-control'], 'no-cache')
  assert.match(requests[0].headers['content-type'], /^text\/plain/)
})

test('large archives use multipart uploads and discard failed multipart state without leaking SDK errors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tbox-sdk-multipart-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const archive = join(directory, 'image.tar.gz')
  await writeFile(archive, '')
  await truncate(archive, 17 * 1024 * 1024)
  let failed = false
  let aborted = false
  let calls = 0
  const client = {
    multipartUpload: async (key, input, config) => {
      calls++
      assert.equal(key, 'releases/image.tar.gz')
      assert.equal(input, archive)
      assert.equal(config.parallel, 3)
      assert.equal(config.partSize, 8 * 1024 * 1024)
      await config.progress(0, { uploadId: 'fixture-upload' })
      if (failed) {
        throw new Error('fixture-secret signed request')
      }
    },
    abortMultipartUpload: async (key, id) => {
      assert.equal(key, 'releases/image.tar.gz')
      assert.equal(id, 'fixture-upload')
      aborted = true
    },
  }
  await putOssObject(client, 'releases/image.tar.gz', archive)
  assert.equal(aborted, false)
  failed = true
  await assert.rejects(putOssObject(client, 'releases/image.tar.gz', archive), (error) => {
    assert.match(error.message, /OSS upload failed/)
    assert.ok(!error.message.includes('fixture-secret'))
    assert.equal(error.cause, undefined)
    return true
  })
  assert.equal(aborted, true)
  assert.equal(calls, 2)
})

test('oversized and interrupted streaming downloads remove partial files and sanitize diagnostics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tbox-sdk-limits-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const mode of ['header', 'stream', 'interrupted']) {
    const client = { getStream: async () => ({
      stream: mode === 'interrupted'
        ? Readable.from((async function* () {
            yield Buffer.from('ok')
            throw new Error('fixture-secret download token')
          })())
        : Readable.from([Buffer.alloc(3), Buffer.alloc(4)]),
      res: { headers: { 'content-length': mode === 'header' ? '100' : undefined } },
    }) }
    await assert.rejects(downloadOssObject(client, 'releases/image.tar.gz', join(directory, 'target'), 6), (error) => {
      assert.match(error.message, /OSS download failed/)
      assert.ok(!error.message.includes('fixture-secret'))
      assert.equal(error.cause, undefined)
      return true
    })
    assert.deepEqual(await readdir(directory), [])
  }
})

test('unsafe object names are rejected before the SDK can send a request', async () => {
  for (const key of ['../secret', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a?signature=secret']) {
    await assert.rejects(putOssObject({}, key, Buffer.from('fixture')), /Invalid OSS object key/)
    await assert.rejects(downloadOssObject({}, key, '/unused', 1024), /Invalid OSS object key/)
  }
})

test('deployment workflows install locked SDK dependencies before preflight and do not install a separate OSS binary', async () => {
  for (const name of ['application-release', 'web-oss', 'api-image', 'api-pm2']) {
    const source = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')
    assert.ok(!source.includes('ossutil'), name)
    const install = source.indexOf('pnpm install --frozen-lockfile')
    const preflight = source.search(/run: node scripts\/(?:deploy-web-oss|upload-bootstrap-oss)\.mjs/)
    assert.ok(install >= 0 && (preflight < 0 || install < preflight), name)
  }
})
