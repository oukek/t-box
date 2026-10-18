import { connectAppClient } from '@t-box/app-web-sdk'
import { createApp, h, watch } from 'vue'
import {
  requestApplicationAuthorization,
  resolveApplicationAuthorization,
} from './applicationAuthorization'
import BookHub from './books/BookHub.vue'
import {
  bookState,
  loadBooks,
  selectBook,
  selectedBook,
} from './books/bookStore'
import { ErrorCode } from './error-codes.js'
import {
  requestFinancialConsent,
  resolveFinancialConsent,
} from './financialConsent'
import Host from './Host.vue'
import { configureRuntime, identity, runtime } from './runtime'
import { request } from './sdk'
import './base.css'

const cancel = () => {
  resolveFinancialConsent(false)
  resolveApplicationAuthorization(false)
}
async function prepare(value: unknown) {
  const id = (value as { ledgerId?: string })?.ledgerId
  if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) {
    throw ErrorCode.INTERNAL_INVALID_LEDGER_ID()
  }
  await loadBooks()
  const book = bookState.books.find((b) => b.id === id)
  if (!book) {
    throw ErrorCode.INTERNAL_LEDGER_ACCESS_DENIED()
  }
  selectBook(id)
  return book
}
connectAppClient({
  async application_authorize(args) {
    const book = await prepare(args)
    const scope = (args as { scope?: string }).scope
    if (
      !book.hasPassword ||
      (!book.locked &&
        (scope === 'read' || book.authorizationScope === 'write'))
    ) {
      return { authorized: true }
    }
    return requestApplicationAuthorization({
      ...(args as object),
      ledgerName: book.name,
    })
  },
  async finance_confirm(args) {
    const book = await prepare(args)
    return requestFinancialConsent({
      ...(args as object),
      ledgerName: book.name,
    })
  },
})
  .then(async (connection) => {
    configureRuntime(connection.client, connection.context)
    identity.user = (
      await request<{ data: NonNullable<typeof identity.user> }>(
        '/ledgers/session',
      )
    ).data
    await loadBooks()
    if (runtime.params.ledgerId) {
      selectBook(runtime.params.ledgerId)
    } else {
      const old = await connection.client.storage.get<string>(
        'ledger.selectedBook.v1',
      )
      if (old) {
        selectBook(old)
      }
    }
    watch(
      selectedBook,
      (book) => {
        void connection.client.resources
          .setBindings(
            book
              ? [{ appId: 'ledger', resourceType: 'book', resourceId: book.id }]
              : [],
          )
          .catch(() => {})
        if (book) {
          void connection.client.storage
            .set('ledger.selectedBook.v1', book.id)
            .catch(() => {})
        }
      },
      { immediate: true },
    )
    connection.client.runtime.onInteractionCancel(cancel)
    connection.client.runtime.onClose(cancel)
    const root = document.getElementById('app')!
    root.textContent = ''
    createApp({
      render: () =>
        h('main', { class: 'application-frame' }, [
          h(BookHub, { ...runtime.params, openRevision: runtime.revision }),
          h(Host),
        ]),
    }).mount(root)
    connection.ready()
    window.addEventListener(
      'pagehide',
      () => {
        cancel()
        connection.client.dispose()
      },
      { once: true },
    )
  })
  .catch((error) => {
    document.getElementById('app')!.textContent =
      error instanceof Error ? error.message : '记账应用连接失败'
  })
