<script setup lang="ts">
import { calendarObject, parseCalendarEvent } from '@t-box/calendar-contracts'
import { syncDeviceReminders } from '@t-box/device-reminders/client'
import { timeSnapshot } from '@t-box/time-contracts'
import { Modal } from '@t-box/ui-kit'
import { onBeforeUnmount, ref } from 'vue'
import { calendarApi } from './api'
import { ErrorCode } from './error-codes.js'
import { identity } from './runtime'

const emit = defineEmits<{ changed: [] }>()
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
const timezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
const today = () => timeSnapshot(timezone).date
const error = ref('')
const mutationBusy = ref(false)
const importInput = ref<HTMLInputElement>()
const importOpen = ref(false)
const importEvents = ref<unknown[]>([])
const importProgress = ref(0)
async function exportBackup() {
  try {
    const list = (await calendarApi.events()).data
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: 'tbox.calendar',
            version: 2,
            events: list.map(
              ({ id, revision, createdAt, updatedAt, ...event }) => event,
            ),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `日历备份-${today()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导出失败'
  }
}
async function readImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  try {
    if (file.size > 5 * 1024 * 1024) {
      throw ErrorCode.INTERNAL_BACKUP_FILE_TOO_LARGE()
    }
    const data = calendarObject(JSON.parse(await file.text()), [
      'format',
      'version',
      'events',
    ])
    if (
      data.format !== 'tbox.calendar' ||
      (data.version !== 1 && data.version !== 2) ||
      !Array.isArray(data.events) ||
      data.events.length > 1000
    ) {
      throw ErrorCode.INTERNAL_INVALID_CALENDAR_BACKUP()
    }
    importEvents.value = data.events.map(parseCalendarEvent)
    importProgress.value = 0
    importOpen.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取备份'
  }
}
async function importBackup() {
  mutationBusy.value = true
  const owner = identity.user?.id
  try {
    for (let i = importProgress.value; i < importEvents.value.length; i++) {
      if (disposed || identity.user?.id !== owner) {
        break
      }
      await calendarApi.create(parseCalendarEvent(importEvents.value[i]))
      importProgress.value = i + 1
    }
    if (disposed || identity.user?.id !== owner) {
      return
    }
    importOpen.value = false
    emit('changed')
    void syncDeviceReminders(true)
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : '导入失败，重试会从未完成的条目继续'
  } finally {
    mutationBusy.value = false
  }
}
</script>

<template>
  <div>
    <p
      v-if="error"
      class="temporal-error"
      role="alert"
    >
      {{ error }}
    </p>
    <details class="calendar-backup">
      <summary>备份与导入</summary>
      <p class="temporal-note">
        JSON
        备份包含事件、备注和提醒设置，不含单次完成／跳过状态。导入为新增事件，不覆盖现有数据。
      </p>
      <button class="temporal-text-button" @click="exportBackup"> 导出日历备份</button><button class="temporal-text-button" @click="importInput?.click()"> 导入备份</button><input
        ref="importInput"
        type="file"
        accept="application/json,.json"
        hidden
        @change="readImport"
      >
    </details>
    <Modal
      :open="importOpen"
      title="导入日历备份"
      :busy="mutationBusy"
      @close="importOpen = false"
    >
      <p class="temporal-note">
        新增 {{ importEvents.length }} 个事件，已完成
        {{ importProgress }} 个。相同备份重复导入会创建新的事件。
      </p>
      <p
        v-if="error"
        class="temporal-error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="temporal-actions">
        <button
          class="button button-secondary"
          :disabled="mutationBusy"
          @click="importOpen = false"
        > 取消</button><button
          class="button button-primary"
          :disabled="mutationBusy"
          @click="importBackup"
        >
          {{ mutationBusy ? "导入中…" : "确认导入" }}
        </button>
      </div>
    </Modal>
  </div>
</template>
