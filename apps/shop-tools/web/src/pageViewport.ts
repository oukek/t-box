// Page gestures stay fixed; TableViewport handles its own two-finger content zoom.
export function lockPageZoom() {
  const prevent = (event: Event) => event.preventDefault()
  const touch = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault()
    }
  }
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault()
    }
  }
  const key = (event: KeyboardEvent) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      ['+', '-', '=', '0'].includes(event.key)
    ) {
      event.preventDefault()
    }
  }
  document.addEventListener('touchmove', touch, { passive: false })
  document.addEventListener('wheel', wheel, { passive: false })
  document.addEventListener('keydown', key)
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, prevent, { passive: false })
  }
  return () => {
    document.removeEventListener('touchmove', touch)
    document.removeEventListener('wheel', wheel)
    document.removeEventListener('keydown', key)
    for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.removeEventListener(name, prevent)
    }
  }
}
