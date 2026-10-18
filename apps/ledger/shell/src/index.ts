import type { ResourceRef } from '@t-box/app-contracts'
import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { Ledger } from '@t-box/ledger-contracts'
import type { Component } from 'vue'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { createShellApplication, identity } from '@t-box/app-shell-sdk'
import {
  ledgerClientInteractions,
  ledgerManifest,
  parseLedgerParams,
} from '@t-box/ledger-contracts'
import {
  defineAsyncComponent,
  defineComponent,
  onBeforeUnmount,
  watch,
} from 'vue'
import { ErrorCode } from './error-codes.js'

interface Ports {
  invoke(tool: string, args: unknown): Promise<unknown>
  bindings(): ResourceRef[]
  cancel(): void
  setBindings(value: ResourceRef[]): void
}
/** No ledger pages or business state are compiled into the host. */
export function createLedgerShellModule(
  load: () => Promise<{ default: Component }>,
  ports: Ports,
): ClientApplicationModule {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: ledgerManifest,
    component: defineAsyncComponent(load),
    host: defineComponent({
      setup() {
        const application = createShellApplication('ledger')
        let epoch = 0
        watch(
          () => identity.user?.id,
          async (id) => {
            const current = ++epoch
            if (!id) {
              return
            }
            try {
              const [{ data: books }, saved] = await Promise.all([
                application.client.api.request<{ data: Ledger[] }>('/ledgers'),
                application.client.storage.get<string>(
                  'ledger.selectedBook.v1',
                ),
              ])
              if (
                current !== epoch ||
                identity.user?.id !== id ||
                ports.bindings().length
              ) {
                return
              }
              let old: string | null = null
              try {
                old = sessionStorage.getItem(`tbox.book.${id}`)
              } catch {}
              const book =
                books.find((b) => b.id === (saved || old)) ||
                books.find((b) => !b.archived) ||
                books[0]
              if (book) {
                ports.setBindings([
                  {
                    appId: 'ledger',
                    resourceType: 'book',
                    resourceId: book.id,
                  },
                ])
                await application.client.storage.set(
                  'ledger.selectedBook.v1',
                  book.id,
                )
              }
            } catch {
              // The application remains usable and can establish its scope on opening.
            }
          },
          { immediate: true },
        )
        onBeforeUnmount(() => {
          epoch++
          application.client.dispose()
        })
        return () => null
      },
    }),
    navigation: 'feature',
    installation: { kind: 'user' },
    parseParams: parseLedgerParams,
    resolveLink(path, query) {
      const token = query.get('token')
      return path === '/join' && token && /^[\w-]{16,200}$/.test(token)
        ? { inviteToken: token }
        : null
    },
    props: (params, context) => ({
      appId: 'ledger',
      params,
      openRevision: context.openRevision,
      persistentNavigation: true,
    }),
    sdk: {
      restPrefixes: ['/ledgers', '/ledger-invitations'],
      storage: true,
      events: {
        books: {
          path: '/ledgers/ws',
          subscribe(args) {
            const id = (args as { ledgerId?: unknown })?.ledgerId
            if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) {
              throw ErrorCode.INTERNAL_INVALID_LEDGER_EVENT()
            }
            return { type: 'subscribe', ledgerId: id }
          },
        },
      },
    },
    ai: {
      interactions: ledgerClientInteractions,
      clientTools: Object.fromEntries(
        ledgerClientInteractions.map((interaction) => [
          interaction.name,
          (args: unknown) => ports.invoke(interaction.name, args),
        ]),
      ),
      bindings: ports.bindings,
      async authorize(resource, purpose) {
        if (resource.resourceType !== 'book') {
          return false
        }
        return Boolean(
          (
            (await ports.invoke('application_authorize', {
              ledgerId: resource.resourceId,
              ledgerName: '账本',
              scope: 'read',
              purpose,
            })) as { authorized?: boolean }
          )?.authorized,
        )
      },
      cancelInteractions: ports.cancel,
    },
  }
}
