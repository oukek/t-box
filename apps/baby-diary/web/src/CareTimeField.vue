<script setup lang="ts">
import { dayjs } from '@t-box/dayjs'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import TimeField from '@t-box/ui-kit/TimeSheetField.vue'
import { computed } from 'vue'

const props = defineProps<{ modelValue: string, timezone: string, label: string, disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const date = computed(() => dayjs(props.modelValue).tz(props.timezone).format('YYYY-MM-DD'))
const time = computed(() => dayjs(props.modelValue).tz(props.timezone).format('HH:mm'))
function update(date: string, time: string) {
  const value = dayjs.tz(`${date} ${time}:00`, props.timezone)
  if (value.isValid()) {
    emit('update:modelValue', value.toISOString())
  }
}
</script>

<template>
  <div class="care-time-field">
    <span>{{ label }}</span>
    <div>
      <DateField
        :model-value="date"
        :label="`${label}日期`"
        :disabled="disabled"
        :max="dayjs().tz(timezone).format('YYYY-MM-DD')"
        @update:model-value="update($event, time)"
      />
      <TimeField
        :model-value="time"
        :label="`${label}时刻`"
        :disabled="disabled"
        @update:model-value="update(date, $event)"
      />
    </div>
  </div>
</template>
