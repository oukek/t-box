import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { Component } from 'vue'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { createShellApplication } from '@t-box/app-shell-sdk'
import { reminderHostAction } from '@t-box/device-reminders/bridge'
import { validateSyncArguments } from '@t-box/device-reminders/deviceReminders'
import { parseTimeParams, timeClientInteractions, timeManifest } from '@t-box/time-contracts'
import { defineAsyncComponent } from 'vue'

export function createTimeShellModule(load: () => Promise<{ default: Component }>, ports: { invoke(tool: string, args: unknown): Promise<unknown>, cancel(): void }): ClientApplicationModule {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: timeManifest,
    component: defineAsyncComponent(load),
    navigation: 'feature',
    installation: { kind: 'system' },
    parseParams: parseTimeParams,
    props: (params, context) => ({ appId: 'time', params, openRevision: context.openRevision, persistentNavigation: true }),
    sdk: { restPrefixes: ['/time'], storage: true, reminders: reminderHostAction, legacyStorageKeys: {
      'time.clocks.v1': (userId) => `tbox.time:${userId}:clocks`,
      'time.stopwatch.v1': (userId) => `tbox.time:${userId}:stopwatch`,
    } },
    ai: { interactions: timeClientInteractions, bindings: () => [], clientTools: { time_reminders_sync: validateSyncArguments }, async authorize(ref) {
      if (ref.resourceType !== 'timer') {
        return false
      }
      const application = createShellApplication('time')
      try {
        return (await application.client.api.request<{ data: { timers: { id: string }[] } }>('/time/timers')).data.timers.some((t) => t.id === ref.resourceId)
      } finally {
        application.client.dispose()
      }
    }, cancelInteractions: ports.cancel },
  }
}
