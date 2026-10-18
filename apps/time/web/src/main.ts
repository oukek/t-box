import { connectAppClient } from '@t-box/app-web-sdk'
import {
  configureReminderClient,
  refreshReminderStatus,
  syncDeviceReminders,
} from '@t-box/device-reminders/client'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { createApp, h } from 'vue'
import { ErrorCode } from './error-codes.js'
import { configureRuntime, loadPreferences, runtime } from './runtime'
import Page from './TimePage.vue'
import './base.css'

connectAppClient({
  time_reminders_sync: async (args: unknown) => {
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
    configureRuntime(connection.client, connection.context)
    await loadPreferences()
    configureReminderClient(connection.client)
    void refreshReminderStatus()

    const root = document.getElementById('app')!
    root.textContent = ''
    createApp({
      render: () =>
        h('main', { class: 'application-frame' }, [
          h(ApplicationHeader, {
            title: '时间',
            backLabel: 'OS',
            onBack: () => connection.client.navigation.back(),
          }),
          h(Page, { ...runtime.params, openRevision: runtime.revision }),
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
