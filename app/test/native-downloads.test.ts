import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultHostDownloads, parseHostDownloads } from '@t-box/app-contracts'
import { downloadAudience, downloadTargets } from '../src/core/native-runtime/download-targets.js'

test('host download settings allow unavailable stores and validate actual App Store destinations', () => {
  assert.deepEqual(parseHostDownloads(defaultHostDownloads), defaultHostDownloads)
  const settings = { displayName: '小方舟', iosAppStoreUrl: 'https://apps.apple.com/cn/app/example/id123456789', androidDownloadUrl: 'https://example.com/android' }
  assert.deepEqual(parseHostDownloads(settings), settings)
  for (const url of ['javascript:alert(1)', 'https://example.com/app/id123', 'https://apps.apple.com/search?term=tbox', 'https://apps.apple.com.evil.example/cn/app/id123', 'https://user:password@apps.apple.com/cn/app/id123', 'http://apps.apple.com/cn/app/id123']) {
    assert.equal(parseHostDownloads({ ...settings, iosAppStoreUrl: url }), null)
  }
  assert.equal(parseHostDownloads({ ...settings, androidDownloadUrl: 'intent://app' }), null)
  assert.equal(parseHostDownloads({ ...settings, displayName: ' ' }), null)
  assert.equal(parseHostDownloads({ ...settings, secret: 'never public' }), null)
})

test('download guidance distinguishes iPad desktop mode, Android and computers', () => {
  const browser = { userAgent: 'Mozilla/5.0 Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }
  assert.equal(downloadAudience(browser), 'desktop')
  assert.equal(downloadAudience({ ...browser, maxTouchPoints: 5 }), 'ios')
  assert.equal(downloadAudience({ ...browser, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)' }), 'ios')
  assert.equal(downloadAudience({ ...browser, userAgent: 'Mozilla/5.0 (Linux; Android 16)' }), 'android')
  assert.deepEqual(downloadTargets(defaultHostDownloads, 'ios').map((entry) => entry.platform), ['ios'])
  assert.deepEqual(downloadTargets(defaultHostDownloads, 'android').map((entry) => entry.platform), ['android'])
  assert.equal(downloadTargets(defaultHostDownloads, 'desktop').length, 2)
  assert.equal(downloadTargets(defaultHostDownloads, 'ios')[0]?.url, '')
})
