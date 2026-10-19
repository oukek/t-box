import type { RuntimeDescriptor } from '@t-box/app-contracts'
import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import { createShellApplication, identity } from '@t-box/app-shell-sdk'
import {
  APPLICATION_CONTRACT_VERSION,
  calculatorManifest,
  parseCalculatorParams,
} from '@t-box/shared'
import { defineAsyncComponent } from 'vue'

export function createCalculatorShellModule(
  loadRuntime: () => Promise<{ default: import('vue').Component }>,
): ClientApplicationModule {
  const ready = loadRuntime
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: calculatorManifest,
    component: defineAsyncComponent(ready),
    prepare: async () => {
      await ready()
    },
    navigation: 'shell',
    parseParams: parseCalculatorParams,
    props: (params, context) => ({
      initializeRuntime: migrateHistory,
      appId: 'calculator',
      params,
      openRevision: context.openRevision,
    }),
    installation: { kind: 'system' },
    ai: {
      clientTools: {},
      interactions: [],
      bindings: () => [],
      authorize: async () => false,
      cancelInteractions() {},
    },
  }
}

/** One-time migration from the former shell origin; keep the original record for rollback. */
async function migrateHistory(runtime: RuntimeDescriptor) {
  const userId = identity.user?.id
  if (!userId) {
    return
  }
  const application = createShellApplication('calculator')
  try {
    const context = await application.client.runtime.getContext()
    if (context.subject !== runtime.subject || identity.user?.id !== userId || !context.capabilities.includes('storage.set')) {
      return
    }
    const target = 'calculator.history.v1'
    if (await application.client.storage.get(target) !== null || identity.user?.id !== userId) {
      return
    }
    const old = localStorage.getItem(
      `tbox.calculator.history.v1:${userId}`,
    )
    if (!old || old.length > 64000) {
      return
    }
    const value = JSON.parse(old)
    if (Array.isArray(value)) {
      await application.client.storage.set(target, value.slice(0, 20))
    }
  } catch {
    /* Storage is optional; no financial/business data is removed. */
  } finally {
    application.client.dispose()
  }
}
