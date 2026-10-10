<script setup lang="ts">
import type { CalendarLunarDate } from '@t-box/calendar-contracts'
import {
  lunarDays,
  lunarEventLabel,
  lunarMonths,
  lunarToSolar,
} from '@t-box/calendar-contracts'
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'

const props = defineProps<{ modelValue: CalendarLunarDate, label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: CalendarLunarDate] }>()
const open = ref(false)
const year = ref(2000)
const month = ref(1)
const day = ref(1)
const error = ref('')
watch(open, (value) => {
  if (!value) {
    return
  }
  year.value = props.modelValue.year
  month.value = props.modelValue.leapMonth
    ? -props.modelValue.month
    : props.modelValue.month
  day.value = props.modelValue.day
  error.value = ''
})
const validYear = computed(
  () =>
    Number.isInteger(year.value) && year.value >= 1900 && year.value <= 2100,
)
const months = computed(() => (validYear.value ? lunarMonths(year.value) : []))
watch(months, (values) => {
  if (!values.length) {
    return
  }
  if (!values.some((m) => m.value === month.value)) {
    month.value = Math.abs(month.value)
  }
  day.value = Math.min(
    day.value,
    values.find((m) => m.value === month.value)!.days,
  )
})
const days = computed(() =>
  months.value.some((m) => m.value === month.value)
    ? lunarDays(year.value, month.value)
    : [],
)
function selectMonth(value: number) {
  month.value = value
  day.value = Math.min(
    day.value,
    months.value.find((m) => m.value === value)!.days,
  )
}
const value = computed<CalendarLunarDate>(() => ({
  ...props.modelValue,
  year: year.value,
  month: Math.abs(month.value),
  leapMonth: month.value < 0,
  day: day.value,
}))
const solar = computed(() => {
  try {
    return lunarToSolar(value.value)
  } catch {
    return ''
  }
})
function confirm() {
  try {
    lunarToSolar(value.value)
    emit('update:modelValue', value.value)
    open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '请选择有效农历日期'
  }
}
</script>

<template>
  <button
    type="button"
    class="lunar-date-trigger"
    :aria-label="`${label}：${lunarEventLabel(modelValue)}`"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="open = true"
  >
    <span>{{ lunarEventLabel(modelValue).replace("农历 ", "") }}</span><AppIcon name="calendar" :size="16" />
  </button>
  <BottomSheet
    :open="open"
    title="选择农历日期"
    @close="open = false"
  >
    <div class="lunar-year">
      <button
        type="button"
        aria-label="上一农历年"
        :disabled="!validYear || year <= 1900"
        @click="year--"
      >
        <AppIcon name="left" :size="18" />
      </button>
      <label>农历年份<input
        v-model.number="year"
        type="number"
        inputmode="numeric"
        min="1900"
        max="2100"
        aria-label="农历年份"
      ></label>
      <button
        type="button"
        aria-label="下一农历年"
        :disabled="!validYear || year >= 2100"
        @click="year++"
      >
        <AppIcon name="right" :size="18" />
      </button>
    </div>
    <p v-if="!validYear" class="temporal-error">请输入 1900 至 2100 年。</p>
    <div
      class="lunar-months"
      role="group"
      aria-label="农历月份"
    >
      <button
        v-for="m in months"
        :key="m.value"
        type="button"
        :aria-pressed="m.value === month"
        @click="selectMonth(m.value)"
      >
        {{ m.label }}
      </button>
    </div>
    <div
      class="lunar-days"
      role="group"
      aria-label="农历日期"
    >
      <button
        v-for="d in days"
        :key="d.value"
        type="button"
        :aria-pressed="d.value === day"
        @click="day = d.value"
      >
        {{ d.label }}
      </button>
    </div>
    <p class="temporal-note">
      {{ solar ? `对应公历 ${solar}` : "所选日期超出支持范围" }} ·
      每个农历年会显示实际闰月和天数。
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
        type="button"
        class="button button-secondary"
        @click="open = false"
      > 取消</button><button
        type="button"
        class="button button-primary"
        :disabled="!solar"
        @click="confirm"
      >
        确定日期
      </button>
    </div>
  </BottomSheet>
</template>

<style scoped>
.lunar-date-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid #dce5e8;
  border-radius: 9px;
  background: #fff;
  color: #385363;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.lunar-date-trigger span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lunar-date-trigger svg {
  flex-shrink: 0;
}
.lunar-year {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 18px;
}
.lunar-year > button {
  border: 0;
  background: var(--accent-soft, #edf5f2);
  border-radius: 10px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--ink);
}
.lunar-year label {
  display: grid;
  gap: 5px;
  text-align: center;
  font-size: 11px;
  color: var(--ink-soft);
}
.lunar-year input {
  width: 120px;
  padding: 8px;
  border: 1px solid #dce5e8;
  border-radius: 9px;
  font: inherit;
  font-size: 16px;
  text-align: center;
}
.lunar-months,
.lunar-days {
  display: grid;
  gap: 6px;
}
.lunar-months {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 18px;
}
.lunar-days {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.lunar-months button,
.lunar-days button {
  min-width: 0;
  min-height: 40px;
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: #f6f8f8;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
}
button[aria-pressed='true'] {
  background: #e6f2ed;
  border-color: #a7cbbd;
  color: var(--accent);
  font-weight: 600;
}
</style>
