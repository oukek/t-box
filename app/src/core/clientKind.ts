/** Installed PWA sessions must not share the browser's shorter-lived credential. */
export function clientKind(): 'mac' | 'pwa' | 'web' {
  if (window.__TBOX_DESKTOP_KEY__) {
    return 'mac'
  }
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone ? 'pwa' : 'web'
}
