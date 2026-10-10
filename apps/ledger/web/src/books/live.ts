import { watch } from 'vue'
import { application } from '../sdk'
import {
  bookState,
  invalidateBook,
  loadBooks,
  selectedBook,
} from './bookStore'

interface BookEvent {
  type: string
  ledgerId: string
  revision?: number
}
/** App owns event meaning. The host owns authentication, reconnect and resource cleanup. */
export function startBookLive() {
  let revision = 0
  let unsubscribe: (() => void) | undefined
  const stop = watch(
    () => [bookState.selectedId, selectedBook.value?.locked] as const,
    ([ledgerId, locked]) => {
      const current = ++revision
      unsubscribe?.()
      unsubscribe = undefined
      if (!ledgerId || locked) {
        return
      }
      void application.client.events
        .subscribe<BookEvent>('books', { ledgerId }, (event) => {
          if (current !== revision) {
            return
          }
          if (event.type === 'ledger.changed') {
            const old = bookState.books.find(
              (book) => book.id === event.ledgerId,
            )?.revision
            invalidateBook(event.ledgerId, event.revision)
            if (old !== event.revision) {
              void loadBooks()
            }
          } else if (event.type === 'ledger.revoked') {
            invalidateBook(event.ledgerId)
            void loadBooks()
          }
        })
        .then((off) => {
          if (current !== revision) {
            off()
          } else {
            unsubscribe = off
          }
        })
        .catch(() => {
          /* REST refresh remains available if live authorization is revoked. */
        })
    },
    { immediate: true },
  )
  return () => {
    revision++
    stop()
    unsubscribe?.()
  }
}
