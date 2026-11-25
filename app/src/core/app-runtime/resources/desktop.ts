import type { ApplicationPackage, ResourceAdapter, ResourceProgress } from './contracts'

export class DesktopResourceAdapter implements ResourceAdapter {
  async prepare(pkg: ApplicationPackage, progress?: (value: ResourceProgress) => void): Promise<'ready'> {
    const { Channel, invoke } = await import('@tauri-apps/api/core')
    const channel = new Channel<ResourceProgress>()
    channel.onmessage = (value) => progress?.(value)
    await invoke('prepare_package', { key: window.__TBOX_DESKTOP_KEY__, pkg, progress: channel })
    return 'ready'
  }

  async open(pkg: ApplicationPackage) {
    const { invoke } = await import('@tauri-apps/api/core')
    const entryUrl = await invoke<string>('open_package', { key: window.__TBOX_DESKTOP_KEY__, pkg })
    return { entryUrl, origin: new URL(entryUrl).origin, source: 'local' as const }
  }

  async remove(pkg: ApplicationPackage) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('remove_package', { key: window.__TBOX_DESKTOP_KEY__, pkg })
  }
}
