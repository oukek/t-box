<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'
import { onBeforeUnmount, watch } from 'vue'
import { notifications, openNotifications } from './store'

let timer: ReturnType<typeof setTimeout> | undefined
watch(() => notifications.toast?.id, () => {
  clearTimeout(timer)
  if (notifications.toast) {
    timer = setTimeout(() => {
      notifications.toast = null
    }, 8000)
  }
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <aside
    v-if="notifications.toast && !notifications.open"
    class="notification-toast"
    role="status"
    aria-live="polite"
  >
    <AppIcon :name="notifications.toast.style === 'warning' ? 'warning' : 'bell'" :size="20" />
    <button class="notification-toast-copy" @click="openNotifications">
      <strong>{{ notifications.toast.title }}</strong>
      <span>{{ notifications.toast.body || '打开通知查看详情' }}</span>
    </button>
    <button
      class="icon-button"
      aria-label="关闭消息提示"
      @click="notifications.toast = null"
    ><AppIcon name="close" :size="16" /></button>
  </aside>
</template>

<style scoped>
.notification-toast {
  position: fixed;
  z-index: 150;
  top: calc(70px + env(safe-area-inset-top));
  right: max(16px, env(safe-area-inset-right));
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(360px, calc(100vw - 24px));
  padding: 14px 10px 14px 14px;
  border: 1px solid #cbded4;
  border-radius: 12px;
  background: #fbfdfc;
  color: #327460;
  box-shadow: 0 10px 32px #20344714;
}
.notification-toast-copy {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
}
.notification-toast-copy strong {
  display: block;
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.notification-toast-copy span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
.notification-toast-copy:focus-visible {
  outline: 2px solid #327460;
  outline-offset: 3px;
  border-radius: 3px;
}
@media (max-width: 700px) {
  .notification-toast {
    top: calc(12px + env(safe-area-inset-top));
    right: 12px;
  }
}
</style>
