import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { marketManifest } from '@t-box/market-contracts'
import { defineAsyncComponent } from 'vue'

export const marketModule: ClientApplicationModule = {
  contractVersion: APPLICATION_CONTRACT_VERSION,
  manifest: marketManifest,
  shellCompatibility: { minimumVersion: '1.0.0' },
  navigation: 'feature',
  sdk: { restPrefixes: [], storage: true },
  installation: { kind: 'system' },
  component: defineAsyncComponent(() => import('./MarketPage.vue')),
  parseParams(value): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'appId') || ('appId' in value && (typeof value.appId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.appId)))) {
      throw new Error('应用市场导航参数无效')
    }
    return 'appId' in value ? { appId: value.appId as string } : {}
  },
  props: (params, { openRevision }) => ({ focusAppId: params.appId || '', openRevision }),
}
