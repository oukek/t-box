import type { ClientApplicationModule } from '@t-box/app-shell-sdk'
import type { Component } from 'vue'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { createShellApplication } from '@t-box/app-shell-sdk'
import { calendarClientInteractions, calendarManifest, parseCalendarParams } from '@t-box/calendar-contracts'
import { reminderHostAction } from '@t-box/device-reminders/bridge'
import { validateSyncArguments } from '@t-box/device-reminders/deviceReminders'
import { defineAsyncComponent } from 'vue'

export function createCalendarShellModule(load: () => Promise<{ default: Component }>, ports: { invoke(tool: string, args: unknown): Promise<unknown>, cancel(): void }): ClientApplicationModule {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: calendarManifest,
    component: defineAsyncComponent(load),
    navigation: 'feature',
    installation: { kind: 'system' },
    parseParams: parseCalendarParams,
    props: (params, context) => ({ appId: 'calendar', params, openRevision: context.openRevision, persistentNavigation: true }),
    sdk: { deviceCapabilities: ['calendar.presentCreate', 'calendar.create', 'calendar.list', 'calendar.update', 'calendar.remove', 'system.openSettings'], restPrefixes: ['/calendar'], storage: true, reminders: reminderHostAction },
    ai: { interactions: calendarClientInteractions, bindings: () => [], clientTools: { calendar_confirm: (args: unknown) => ports.invoke('calendar_confirm', args), calendar_reminders_sync: validateSyncArguments }, async authorize(ref) {
      if (ref.resourceType !== 'event') {
        return false
      }
      const application = createShellApplication('calendar')
      try {
        await application.client.api.request(`/calendar/events/${encodeURIComponent(ref.resourceId)}`)
        return true
      } finally {
        application.client.dispose()
      }
    }, cancelInteractions: ports.cancel },
  }
}
