import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultDesktopWallpapers, resolveWallpaper, wallpaperDevice } from '@t-box/app-contracts'

test('device overrides inherit the common wallpaper independently', () => {
  const settings = { ...defaultDesktopWallpapers(), common: { kind: 'resource' as const, resourceId: 'photo' }, mobile: { kind: 'builtin' as const, id: 'coast-dusk' } }
  assert.deepEqual(resolveWallpaper(settings, 'mobile'), settings.mobile)
  assert.deepEqual(resolveWallpaper(settings, 'tablet'), settings.common)
  assert.deepEqual(resolveWallpaper(settings, 'pc'), settings.common)
  assert.deepEqual(resolveWallpaper({ ...settings, mobile: null }, 'mobile'), settings.common)
})
test('responsive wallpaper selection keeps touch devices stable on rotation', () => {
  assert.equal(wallpaperDevice(390, 844), 'mobile')
  assert.equal(wallpaperDevice(768, 1024), 'tablet')
  assert.equal(wallpaperDevice(1440, 900), 'pc')
  assert.equal(wallpaperDevice(1440, 500), 'pc')
  assert.equal(wallpaperDevice(844, 390, true), 'mobile')
  assert.equal(wallpaperDevice(1024, 1366, true), 'tablet')
  assert.equal(wallpaperDevice(1366, 1024, true), 'tablet')
})
