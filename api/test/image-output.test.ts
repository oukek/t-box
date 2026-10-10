import assert from 'node:assert/strict'
import test from 'node:test'
import { publicRunError } from '../src/chat/errors.js'
import {
  downloadImage,
  imageDownloadUrl,
  imageOutput,
  publicImageAddress,
} from '../src/resources/image-output.js'
import { MAX_RESOURCE_SIZE } from '../src/resources/service.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=',
  'base64',
)
test('base64, data URI and provider URL outputs become the same owned image bytes', async () => {
  const signal = new AbortController().signal
  for (const b64_json of [
    png.toString('base64'),
    `data:image/png;base64,${png.toString('base64')}`,
  ]) {
    const output = await imageOutput({ b64_json }, signal)
    assert.deepEqual(output.bytes, png)
    assert.equal(output.mime, 'image/png')
  }
  let calls = 0
  const output = await imageOutput(
    { url: 'https://cdn.example.com/image.png?signature=temporary' },
    signal,
    async (url, passedSignal) => {
      assert.equal(
        url,
        'https://cdn.example.com/image.png?signature=temporary',
      )
      assert.equal(passedSignal, signal)
      calls++
      return png
    },
  )
  assert.deepEqual(output.bytes, png)
  assert.equal(output.mime, 'image/png')
  assert.equal(calls, 1)
})
test('downloads reject private, loopback, mapped and non-public addresses and unsafe URL schemes', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.2',
    '172.20.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2002:7f00:1::1',
  ]) {
    assert.equal(publicImageAddress(address), false, address)
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(publicImageAddress(address), true, address)
  }
  for (const url of [
    'http://cdn.example.com/image.png',
    'file:///etc/passwd',
    'https://secret@cdn.example.com/image.png',
    'https://cdn.example.com:3000/image.png',
  ]) {
    assert.throws(() => imageDownloadUrl(url), { code: 'IMAGE_URL_INVALID' })
  }
  await assert.rejects(
    downloadImage('https://localhost/image.png', new AbortController().signal),
    { code: 'IMAGE_URL_BLOCKED' },
  )
})
test('missing, malformed, oversized and non-image outputs fail before resource persistence', async () => {
  const signal = new AbortController().signal
  for (const output of [
    undefined,
    {},
    { b64_json: 'not base64!!' },
    { b64_json: Buffer.from('not an image').toString('base64') },
  ]) {
    await assert.rejects(imageOutput(output, signal), {
      code: 'IMAGE_OUTPUT_INVALID',
    })
  }
  await assert.rejects(
    imageOutput({ url: 'https://cdn.example.com/image' }, signal, async () =>
      Buffer.alloc(MAX_RESOURCE_SIZE + 1)),
    { code: 'IMAGE_OUTPUT_INVALID' },
  )
  await assert.rejects(
    imageOutput({ url: 'https://cdn.example.com/image' }, signal, async () =>
      Buffer.from('<html>error</html>')),
    { code: 'IMAGE_OUTPUT_INVALID' },
  )
})
test('provider JSON parse errors are concise and don\'t expose raw response bodies', () => {
  const result = publicRunError(new SyntaxError('secret raw provider html'))
  assert.equal(result.code, 'PROVIDER_INVALID_JSON')
  assert.ok(!result.message.includes('secret'))
})
