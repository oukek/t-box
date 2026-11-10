<script setup lang="ts">
import { AppIcon } from '@t-box/ui-kit'
import { notifications, openNotifications } from './store'
</script>

<template>
  <button
    class="notification-bell desktop-action"
    :aria-label="notifications.unread ? `通知，${notifications.unread} 条未读` : '通知'"
    title="通知"
    @click="openNotifications"
  >
    <AppIcon name="bell" :size="19" />
    <span
      v-if="notifications.unread"
      class="notification-badge"
      aria-hidden="true"
    >{{ notifications.unread > 99 ? '99+' : notifications.unread }}</span>
  </button>
</template>

<style scoped>
.notification-bell {
  position: relative;
}
.notification-badge {
  position: absolute;
  top: 0;
  right: -3px;
  min-width: 15px;
  padding: 0 3px;
  height: 15px;
  border-radius: 8px;
  background: #397662;
  color: #fff;
  font-size: 9px;
  line-height: 15px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
