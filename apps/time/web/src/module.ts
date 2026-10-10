import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { validateSyncArguments } from '@t-box/device-reminders/deviceReminders'
import {
  parseTimeParams,
  timeClientInteractions,
  timeManifest,
} from '@t-box/time-contracts'
import { defineAsyncComponent } from 'vue'
import { timeApi } from './api'

const ready = () => import('./TimePage.vue')
export const timeModule: ClientApplicationModule = {
  contractVersion: APPLICATION_CONTRACT_VERSION,
  manifest: timeManifest,
  component: defineAsyncComponent(ready),
  prepare: async () => {
    await ready()
  },
  navigation: 'shell',
  parseParams: parseTimeParams,
  props: (params, context) => ({
    ...params,
    openRevision: context.openRevision,
  }),
  sdk: { restPrefixes: ['/time'], storage: true },
  installation: { kind: 'system' },
  ai: {
    interactions: timeClientInteractions,
    clientTools: { time_reminders_sync: validateSyncArguments },
    bindings: () => [],
    async authorize(ref) {
      if (ref.resourceType !== 'timer') {
        return false
      }
      return (await timeApi.list()).data.timers.some(
        (t) => t.id === ref.resourceId,
      )
    },
    cancelInteractions() {},
  },
}
