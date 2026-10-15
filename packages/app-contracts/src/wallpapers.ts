/** Host-owned appearance contract; application business settings do not belong here. */
export const builtinWallpapers = [
  { id: 'lake-dusk', name: '山湖暮色', url: '/wallpapers/lake-dusk.jpg' },
  { id: 'coast-dusk', name: '海岸微光', url: '/wallpapers/coast-dusk.jpg' },
  { id: 'dunes-dusk', name: '沙丘晚照', url: '/wallpapers/dunes-dusk.jpg' },
] as const
export type WallpaperSource =
  | { kind: 'builtin', id: string } |
  { kind: 'resource', resourceId: string }
export const wallpaperDevices = ['mobile', 'tablet', 'pc'] as const
export type WallpaperDevice = typeof wallpaperDevices[number]
export type WallpaperTarget = 'common' | WallpaperDevice
export interface DesktopWallpapers {
  common: WallpaperSource
  mobile: WallpaperSource | null
  tablet: WallpaperSource | null
  pc: WallpaperSource | null
}
export interface DesktopAppearanceSnapshot {
  revision: number
  wallpapers: DesktopWallpapers
}
export interface DesktopAppearanceState extends DesktopAppearanceSnapshot {
  loading: boolean
  saving: boolean
  error: string
  imageUrls: Record<string, string>
}
export const defaultDesktopWallpapers = (): DesktopWallpapers => ({
  common: { kind: 'builtin', id: 'lake-dusk' },
  mobile: null,
  tablet: null,
  pc: null,
})
/** Touch devices keep their phone/tablet wallpaper when rotated. Other windows follow their width. */
export function wallpaperDevice(width: number, height: number, touch = false): WallpaperDevice {
  if (touch) {
    return Math.min(width, height) < 600 ? 'mobile' : 'tablet'
  }
  return width < 600 ? 'mobile' : width < 1200 ? 'tablet' : 'pc'
}
export function resolveWallpaper(settings: Readonly<DesktopWallpapers>, device: WallpaperDevice): WallpaperSource {
  return settings[device] ?? settings.common
}
export function builtinWallpaperUrl(source: Readonly<WallpaperSource>): string {
  return source.kind === 'builtin' ? builtinWallpapers.find((wallpaper) => wallpaper.id === source.id)?.url ?? builtinWallpapers[0].url : ''
}
