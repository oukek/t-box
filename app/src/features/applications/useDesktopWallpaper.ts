import { builtinWallpapers, builtinWallpaperUrl, resolveWallpaper, wallpaperDevice } from '@t-box/app-contracts'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { desktopAppearance, refreshDesktopAppearance } from '../../core/desktopAppearance'

export function useDesktopWallpaper() {
  const device = ref(wallpaperDevice(innerWidth, innerHeight, matchMedia('(pointer: coarse)').matches))
  const resize = () => {
    device.value = wallpaperDevice(innerWidth, innerHeight, matchMedia('(pointer: coarse)').matches)
  }
  const visible = () => {
    if (!document.hidden) {
      void refreshDesktopAppearance()
    }
  }
  onMounted(() => {
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visible)
    void refreshDesktopAppearance()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize)
    document.removeEventListener('visibilitychange', visible)
  })
  return computed(() => {
    const source = resolveWallpaper(desktopAppearance.wallpapers, device.value)
    const urlFor = (item: typeof source) => item.kind === 'resource' ? desktopAppearance.imageUrls[item.resourceId] : builtinWallpaperUrl(item)
    const selectedUrl = urlFor(source)
    const common = desktopAppearance.wallpapers.common
    const url = selectedUrl || urlFor(common)
    const custom = selectedUrl ? source.kind === 'resource' : common.kind === 'resource' && !!url
    return {
      '--desktop-wallpaper-image': `url(${JSON.stringify(url || builtinWallpapers[0].url)})`,
      '--desktop-wallpaper-shade': custom ? '0.4' : '0.12',
    }
  })
}
