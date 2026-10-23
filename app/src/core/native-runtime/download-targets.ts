import type { HostDownloadSettings } from '@t-box/app-contracts'

export type DownloadAudience = 'ios' | 'android' | 'desktop'
export function downloadAudience(device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): DownloadAudience {
  if (/iPhone|iPad|iPod/i.test(device.userAgent) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1)) {
    return 'ios'
  }
  return /Android/i.test(device.userAgent) ? 'android' : 'desktop'
}
export function downloadTargets(settings: HostDownloadSettings, audience: DownloadAudience) {
  const targets = [
    { platform: 'ios' as const, label: 'App Store', description: 'iPhone / iPad', url: settings.iosAppStoreUrl },
    { platform: 'android' as const, label: 'Android 版', description: '官方应用下载', url: settings.androidDownloadUrl },
  ]
  return targets.filter((target) => audience === 'desktop' || target.platform === audience)
}
