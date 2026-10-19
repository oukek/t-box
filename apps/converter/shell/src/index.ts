import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { Component } from 'vue'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { converterManifest, parseConverterParams } from '@t-box/converter-contracts'
import { defineAsyncComponent } from 'vue'

export function createConverterShellModule(load: () => Promise<{ default: Component }>): ClientApplicationModule {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: converterManifest,
    navigation: 'feature',
    component: defineAsyncComponent(load),
    installation: { kind: 'system' },
    parseParams: parseConverterParams,
    props: (params, context) => ({ appId: 'converter', params, openRevision: context.openRevision, persistentNavigation: true }),
    sdk: { storage: true },
    ai: { clientTools: {}, interactions: [], bindings: () => [], authorize: async () => false, cancelInteractions() {} },
  }
}
