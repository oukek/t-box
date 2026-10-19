import { connectAppClient } from '@t-box/app-web-sdk'
import {
  configureReminderClient,
  refreshReminderStatus,
  syncDeviceReminders,
} from '@t-box/device-reminders/client'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { createApp, h } from 'vue'
import Page from './CalendarPage.vue'
import {
  requestCalendarConfirmation,
  resolveCalendarConfirmation,
} from './confirmation'
import { ErrorCode } from './error-codes.js'
import Host from './Host.vue'
import { configureRuntime, runtime } from './runtime'
import './base.css'

connectAppClient({
  calendar_confirm: requestCalendarConfirmation,
  calendar_reminders_sync: async (args: unknown) => {
    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).length
    ) {
      throw ErrorCode.INTERNAL_INVALID_REMINDER_PLAN()
    }
    return syncDeviceReminders(true)
  },
})
  .then(async (connection) => {
    configureRuntime(connection.client, connection.context, (await connection.client.auth.getSession()).status === 'signed_in')
    configureReminderClient(connection.client)
    void refreshReminderStatus()
    connection.client.runtime.onInteractionCancel(() =>
      resolveCalendarConfirmation(false),
    )
    connection.client.runtime.onClose(() => resolveCalendarConfirmation(false))
    const root = document.getElementById('app')!
    root.textContent = ''
    createApp({
      render: () =>
        h('main', { class: 'application-frame' }, [
          h(ApplicationHeader, {
            title: '日历',
            backLabel: 'OS',
            onBack: () => connection.client.navigation.back(),
          }),
          h(Page, { ...runtime.params, openRevision: runtime.revision }),
          h(Host),
        ]),
    }).mount(root)
    connection.ready()
    window.addEventListener('pagehide', () => connection.client.dispose(), {
      once: true,
    })
  })
  .catch((error) => {
    document.getElementById('app')!.textContent =
      error instanceof Error ? error.message : '应用连接失败'
  })
