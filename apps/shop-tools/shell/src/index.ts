import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { Component } from 'vue'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { manifest } from '@t-box/shop-tools-contracts'
import { defineAsyncComponent } from 'vue'

export function createShopToolsShellModule(
  load: () => Promise<{ default: Component }>,
): ClientApplicationModule {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest,
    navigation: 'feature',
    component: defineAsyncComponent(load),
    installation: { kind: 'user' },
    parseParams: () => ({}),
    props: (params, context) => ({
      appId: 'shop-tools',
      params,
      openRevision: context.openRevision,
      persistentNavigation: true,
    }),
    sdk: {},
    ai: {
      clientTools: {},
      interactions: [],
      bindings: () => [],
      authorize: async () => false,
      cancelInteractions() {},
    },
  }
}
