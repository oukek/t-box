import type { Ledger } from '@t-box/ledger-contracts'
import { computed, reactive, readonly } from 'vue'
import { identity } from '../runtime'
import { booksApi } from './booksApi'

const state = reactive({
  books: [] as Ledger[],
  selectedId: '',
  loading: false,
  error: '',
  revision: 0,
})
export const bookState = readonly(state)
export const selectedBook = computed(() =>
  state.books.find((book) => book.id === state.selectedId),
)
let generation = 0
export function selectBook(id: string) {
  if (state.books.some((book) => book.id === id)) {
    state.selectedId = id
    try {
      sessionStorage.setItem(`tbox.book.${identity.user?.id}`, id)
    } catch {
      /* memory fallback */
    }
  }
}
export async function loadBooks() {
  const current = ++generation
  state.loading = true
  state.error = ''
  try {
    const { data } = await booksApi.list()
    if (current !== generation) {
      return
    }
    state.books = data
    if (!data.some((book) => book.id === state.selectedId)) {
      let stored = ''
      try {
        stored = sessionStorage.getItem(`tbox.book.${identity.user?.id}`) || ''
      } catch {}
      state.selectedId =
        data.find((book) => book.id === stored)?.id ??
        data.find((book) => !book.archived)?.id ??
        data[0]?.id ??
        ''
    }
  } catch (cause) {
    if (current === generation) {
      state.error = cause instanceof Error ? cause.message : '账本读取失败'
    }
  } finally {
    if (current === generation) {
      state.loading = false
    }
  }
}
export function resetBooks() {
  generation++
  state.books = []
  state.selectedId = ''
  state.error = ''
  state.loading = false
}
export function invalidateBook(id: string, revision?: number) {
  const book = state.books.find((book) => book.id === id)
  if (book && book.revision !== revision) {
    if (revision !== undefined) {
      book.revision = revision
    }
    state.revision++
  }
}
