import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { profileManifest } from '@t-box/settings-contracts'
import { defineAsyncComponent } from 'vue'
import './pages/profile.css'

const ready = () => import('./pages/SettingsPage.vue')
/** The settings app keeps its historical installation ID; it has no AI adapter. */
export const profileModule: ClientApplicationModule = {
  contractVersion: APPLICATION_CONTRACT_VERSION,
  manifest: profileManifest,
  presentation: {
    name: '设置',
    description: '账号、安全与使用偏好',
    icon: 'settings',
  },
  sdk: { restPrefixes: [], storage: true },
  installation: { kind: 'system' },
  navigation: 'feature',
  component: defineAsyncComponent(ready),
  prepare: async () => {
    await ready()
  },
  parseParams(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length
    ) {
      throw new Error('设置应用不接受导航参数')
    }
    return {}
  },
  props: () => ({}),
}
