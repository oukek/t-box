/** Account for the visual viewport when the native on-screen keyboard opens. */
export function observeViewport(): () => void {
  const viewport = window.visualViewport
  const preventPageZoom = (event: Event) => event.preventDefault()
  const update = () => {
    const height = viewport?.height || window.innerHeight
    document.documentElement.style.setProperty('--visible-height', `${height}px`)
    const focused = document.activeElement
    const keyboardOpen = window.innerHeight - height > 120 && (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement)
    document.documentElement.classList.toggle('keyboard-open', keyboardOpen)
  }
  update()
  viewport?.addEventListener('resize', update)
  window.addEventListener('resize', update)
  document.addEventListener('focusin', update)
  document.addEventListener('focusout', update)
  // WKWebView/Safari can ignore viewport zoom limits; keep page gestures at 1x.
  document.addEventListener('gesturestart', preventPageZoom, { passive: false })
  document.addEventListener('gesturechange', preventPageZoom, { passive: false })
  return () => {
    viewport?.removeEventListener('resize', update)
    window.removeEventListener('resize', update)
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', update)
    document.removeEventListener('gesturestart', preventPageZoom)
    document.removeEventListener('gesturechange', preventPageZoom)
    document.documentElement.classList.remove('keyboard-open')
    document.documentElement.style.removeProperty('--visible-height')
  }
}
