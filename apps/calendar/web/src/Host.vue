<script setup lang="ts">
import ReminderHost from '@t-box/device-reminders/ReminderHost.vue'
import { Modal } from '@t-box/ui-kit'
import {
  calendarConfirmation,
  resolveCalendarConfirmation,
} from './confirmation'
</script>

<template>
  <ReminderHost /><Modal
    :open="!!calendarConfirmation"
    :title="calendarConfirmation?.title || '确认操作'"
    @close="resolveCalendarConfirmation(false)"
  >
    <p class="temporal-note">
      {{ calendarConfirmation?.message }}
    </p>
    <div class="temporal-actions">
      <button
        class="button button-secondary"
        @click="resolveCalendarConfirmation(false)"
      > 取消</button><button
        class="button button-danger"
        @click="resolveCalendarConfirmation(true)"
      >
        确认删除
      </button>
    </div>
  </Modal>
</template>
