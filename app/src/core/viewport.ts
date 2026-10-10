/** Account for the visual viewport when the native on-screen keyboard opens. */
export function observeViewport(): () => void {
  const viewport = window.visualViewport
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
  return () => {
    viewport?.removeEventListener('resize', update)
    window.removeEventListener('resize', update)
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', update)
    document.documentElement.classList.remove('keyboard-open')
    document.documentElement.style.removeProperty('--visible-height')
  }
}
