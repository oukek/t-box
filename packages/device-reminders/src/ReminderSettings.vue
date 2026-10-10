<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import {
  enableDeviceReminders,
  reminderStatus,
  requestExactAlarms,
  syncDeviceReminders,
} from './deviceReminders'
</script>

<template>
  <details class="reminder-settings">
    <summary>提醒设置</summary>
    <p v-if="!Capacitor.isNativePlatform()">
      网页版仅在页面打开时显示提醒；关闭页面后不会发出通知。App 可授权系统通知。
    </p>
    <template v-else>
      <p>
        {{
          reminderStatus.state === "granted"
            ? `已授权系统通知，已安排 ${reminderStatus.scheduled} 条本机提醒。`
            : "尚未启用本机系统通知。"
        }}{{
          reminderStatus.truncated
            ? "仅安排最近 48 条，打开应用后会继续补充。"
            : ""
        }}
      </p>
      <button class="temporal-text-button" @click="enableDeviceReminders">
        {{
          reminderStatus.state === "granted" ? "检查提醒权限" : "启用系统通知"
        }}
      </button><button class="temporal-text-button" @click="syncDeviceReminders(true)"> 同步提醒</button><template
        v-if="Capacitor.getPlatform() === 'android' && !reminderStatus.exact"
      >
        <p>
          Android 尚未授权精确闹钟，后台提醒可能延迟；系统省电设置也会影响提醒。
        </p>
        <button class="temporal-text-button" @click="requestExactAlarms">
          打开精确提醒设置
        </button>
      </template>
    </template>
    <p v-if="reminderStatus.error" role="alert">
      {{ reminderStatus.error }}
    </p>
    <p>日历全天事件在事件时区上午 9 点提醒。提醒仅对已同步的当前设备生效。</p>
  </details>
</template>

<style scoped>
.reminder-settings {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid #e1e8e4;
  font-size: 12px;
  color: #6f8b7a;
}
.reminder-settings summary {
  cursor: pointer;
  width: fit-content;
}
.reminder-settings p {
  font-size: 11px;
  line-height: 1.9;
  color: #8a9b91;
}
.reminder-settings button {
  margin-right: 15px;
}
</style>
