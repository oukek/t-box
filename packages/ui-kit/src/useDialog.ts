import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { lockDocumentScroll } from './sheetScroll'

/** Synchronize with the mounted element as well as the prop (including async/initially open views). */
export function useDialog(
  open: () => boolean,
  options: { opened?: () => void, closed?: () => void } = {},
) {
  const dialog = shallowRef<HTMLDialogElement>()
  let previous: HTMLElement | null = null
  let release: (() => void) | undefined
  function restore() {
    if (!release) {
      return
    }
    options.closed?.()
    release()
    release = undefined
    const target = previous
    previous = null
    if (target?.isConnected) {
      target.focus()
    }
  }
  function closed() {
    // Native close events are queued: an old event must not unlock a reopened dialog.
    if (!dialog.value?.open) {
      restore()
    }
  }
  watch([open, dialog], () => {
    const element = dialog.value
    if (!element) {
      return
    }
    if (open()) {
      if (element.open) {
        return
      }
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      release ??= lockDocumentScroll()
      element.showModal()
      element.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus({ preventScroll: true })
      options.opened?.()
    } else if (element.open) {
      element.close()
    }
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    dialog.value?.close()
    restore()
  })
  return { dialog, closed }
}
