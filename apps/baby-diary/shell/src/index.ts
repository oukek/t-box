import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { Component } from 'vue'
import { createShellApplication } from '@t-box/app-shell-sdk'
import {
  babyDiaryManifest,
  parseBabyParams,
} from '@t-box/baby-diary-contracts'
import { defineAsyncComponent } from 'vue'

export function createBabyDiaryShellModule(
  load: () => Promise<{ default: Component }>,
): ClientApplicationModule {
  return {
    contractVersion: '1.0',
    manifest: babyDiaryManifest,
    navigation: 'feature',
    component: defineAsyncComponent(load),
    installation: { kind: 'user' },
    parseParams: parseBabyParams,
    props: (params, context) => ({
      appId: 'baby-diary',
      params,
      openRevision: context.openRevision,
      persistentNavigation: true,
    }),
    sdk: { storage: true },
    ai: {
      clientTools: {},
      interactions: [],
      bindings: () => [],
      async authorize(ref) {
        const application = createShellApplication('baby-diary')
        try {
          if (ref.resourceType === 'baby') {
            await application.client.api.invoke('babies_get', {
              babyId: ref.resourceId,
            })
          } else {
            // Empty metadata lookup performs the app's exact content-scope authorization.
            await application.client.api.invoke('assets_list', {
              babyId: ref.resourceId,
              scope: ref.resourceType,
              ids: [],
            })
          }
          return true
        } finally {
          application.client.dispose()
        }
      },
      cancelInteractions() {},
    },
  }
}
