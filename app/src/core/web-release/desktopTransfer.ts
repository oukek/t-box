export interface DesktopOffer { id: string, notes: string, ui?: string, core?: string }
export interface DesktopProgress {
  phase: string
  bytes: number
  total?: number
  component?: 'ui' | 'core'
  completed_bytes?: number
  download_total?: number
}
export interface Transfer { busy: boolean, progress?: DesktopProgress, offer?: DesktopOffer, error?: string }

export const startupTransfer: { current?: Transfer } = {}
export async function readTransfer() {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<Transfer>('desktop_transfer', { key: window.__TBOX_DESKTOP_KEY__ })
}
export async function readStartupTransfer() {
  // Older desktop cores support install but do not expose a transfer snapshot.
  startupTransfer.current = await readTransfer().catch(() => undefined)
}
