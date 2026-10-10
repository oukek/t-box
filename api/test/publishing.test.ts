import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ApplicationArtifacts } from '../src/application-platform/artifacts.js'
import { validVersion } from '../src/application-platform/publishing.js'

test('application version IDs require a three-part version and disallow ambiguous numeric segments', () => {
  for (const value of ['1.0.0', '0.1.9', '3.4.5-beta.1']) {
    assert.equal(validVersion(value), true)
  }
  for (const value of [
    '1',
    'v1.0.0',
    '01.0.0',
    '1.0.0+metadata',
    '1.2',
    '../1.0.0',
    null,
  ]) {
    assert.equal(validVersion(value), false)
  }
})
test('static artifact upload validates paths, encoding, duplicates and content hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-artifacts-'))
  const service = new ApplicationArtifacts(root)
  const content = Buffer.from(
    '<!doctype html><html lang="zh-CN">应用</html>',
  ).toString('base64')
  try {
    const first = await service.upload('notes', {
      files: [{ path: 'index.html', content }],
    })
    assert.equal(
      (await service.verify('notes', first.digest)).digest,
      first.digest,
    )
    assert.equal(
      (
        await service.upload('notes', {
          files: [{ path: 'index.html', content }],
        })
      ).digest,
      first.digest,
      'same content is immutable and deduplicated',
    )
    for (const path of [
      '../escape',
      '/index.html',
      'assets/../../escape',
      'assets//a.js',
      'artifact.json',
    ]) {
      await assert.rejects(
        service.upload('notes', { files: [{ path, content }] }),
        /无效/,
      )
    }
    await assert.rejects(
      service.upload('notes', {
        files: [
          { path: 'index.html', content },
          { path: 'index.html', content },
        ],
      }),
      /无效/,
    )
    await assert.rejects(
      service.upload('notes', {
        files: [{ path: 'index.html', content: 'not base64' }],
      }),
      /编码/,
    )
    await assert.rejects(service.verify('other', first.digest), /不存在/)
    await writeFile(join(root, 'notes', first.digest, 'index.html'), 'changed')
    await assert.rejects(service.verify('notes', first.digest), /摘要不一致/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('artifact verification rejects symbolic links even if a manifest file still matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbox-artifact-links-'))
  const service = new ApplicationArtifacts(root)
  try {
    const { digest } = await service.upload('notes', {
      files: [{ path: 'index.html', content: 'eA==' }],
    })
    await symlink(
      join(root, 'notes', digest, 'index.html'),
      join(root, 'notes', digest, 'linked.html'),
    )
    await assert.rejects(service.verify('notes', digest), /链接/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
