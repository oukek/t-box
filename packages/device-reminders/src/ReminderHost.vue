<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { identity, openApplication } from '@t-box/app-shell-sdk'
import { AppIcon } from '@t-box/ui-kit'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import {
  checkDueReminders,
  dueReminder,
  syncDeviceReminders,
} from './deviceReminders'

let unmounted = false
let ticker: ReturnType<typeof setInterval> | undefined
let poll: ReturnType<typeof setInterval> | undefined
let listener: { remove: () => Promise<void> } | undefined
const refresh = () => {
  if (identity.user) {
    void syncDeviceReminders()
  }
}
watch(() => identity.user?.id, refresh, { immediate: true })
function foreground() {
  if (document.visibilityState === 'visible') {
    refresh()
  }
}
onMounted(async () => {
  ticker = setInterval(checkDueReminders, 1000)
  poll = setInterval(() => {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  }, 15000)
  document.addEventListener('visibilitychange', foreground)
  if (Capacitor.isNativePlatform()) {
    const api = (await import('@capacitor/local-notifications'))
      .LocalNotifications
    if (unmounted) {
      return
    }
    listener = await api.addListener(
      'localNotificationActionPerformed',
      (event) => {
        const extra = event.notification.extra
        if (extra?.owner === identity.user?.id && extra.destination) {
          void openApplication(extra.destination)
        }
      },
    )
    if (unmounted) {
      await listener.remove()
    }
  }
})
onBeforeUnmount(() => {
  unmounted = true
  clearInterval(ticker)
  clearInterval(poll)
  document.removeEventListener('visibilitychange', foreground)
  void listener?.remove()
})
</script>

<template>
  <aside
    v-if="dueReminder"
    class="device-reminder-banner"
    role="status"
  >
    <AppIcon name="calendar" :size="22" /><button
      class="device-reminder-open"
      @click="
        openApplication(dueReminder.destination);
        dueReminder = null;
      "
    >
      <strong>{{ dueReminder.title }}</strong><span>{{ dueReminder.body }}</span>
    </button><button
      class="icon-button"
      aria-label="关闭提醒"
      @click="dueReminder = null"
    >
      <AppIcon name="close" :size="18" />
    </button>
  </aside>
</template>

<style scoped>
.device-reminder-banner {
  position: fixed;
  z-index: 20;
  left: 50%;
  transform: translateX(-50%);
  top: calc(12px + env(safe-area-inset-top));
  width: min(440px, calc(100% - 24px));
  display: flex;
  gap: 12px;
  align-items: center;
  background: #fff;
  padding: 14px;
  border: 1px solid #cbded4;
  border-radius: 14px;
  box-shadow: 0 8px 32px #20344720;
  color: #286b59;
}
.device-reminder-open {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0;
}
.device-reminder-open strong {
  display: block;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.device-reminder-open span {
  display: block;
  font-size: 11px;
  color: #8a9b91;
  margin-top: 5px;
}
</style>
