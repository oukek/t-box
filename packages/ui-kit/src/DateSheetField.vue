<script setup lang="ts">
import type { DateMode } from './calendar'
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, nextTick, ref, watch } from 'vue'
import {
  calendarCells,
  calendarDate,
  dateKey,
  localDate,
  periodAvailable,
} from './calendar'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    mode?: DateMode
    min?: string
    max?: string
    clearable?: boolean
    disabled?: boolean
    compact?: boolean
  }>(),
  { mode: 'date', min: '1900-01-01', max: '9999-12-31' },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'change': [value: string]
}>()
const open = ref(false)
const draft = ref('')
const year = ref(2026)
const month = ref(1)
const view = ref<'date' | 'month' | 'year' | 'quarter'>('date')
const yearPage = ref(2020)
const display = computed(() => {
  if (!props.modelValue) {
    return '未设置'
  }
  const [y, m, d] = props.modelValue.split('-')
  if (props.mode === 'year') {
    return `${y}年`
  }
  if (props.mode === 'quarter') {
    return `${y}年 第${m?.slice(1)}季度`
  }
  return `${y}年${Number(m)}月${props.mode === 'date' ? `${Number(d)}日` : ''}`
})
const cells = computed(() => calendarCells(year.value, month.value))
const years = computed(() =>
  Array.from({ length: 12 }, (_, i) => yearPage.value + i),
)
const minimumYear = computed(() => Number(props.min.slice(0, 4)))
const maximumYear = computed(() => Number(props.max.slice(0, 4)))
const canConfirm = computed(
  () =>
    !!draft.value &&
    periodAvailable(draft.value, props.mode, props.min, props.max),
)
function initial() {
  const today = localDate()
  const base = props.modelValue || today
  year.value = Math.max(
    minimumYear.value,
    Math.min(
      maximumYear.value,
      Number(base.slice(0, 4)) || Number(today.slice(0, 4)),
    ),
  )
  month.value =
    props.mode === 'quarter' && props.modelValue
      ? (Number(base.slice(-1)) - 1) * 3 + 1
      : Number(base.slice(5, 7)) || Number(today.slice(5, 7))
  draft.value = props.modelValue || formatMode(today)
  if (!periodAvailable(draft.value, props.mode, props.min, props.max)) {
    draft.value = formatMode(today < props.min ? props.min : props.max)
  }
  year.value = Number(draft.value.slice(0, 4))
  month.value =
    props.mode === 'quarter'
      ? (Number(draft.value.slice(-1)) - 1) * 3 + 1
      : Number(draft.value.slice(5, 7)) || month.value
  view.value = props.mode
  yearPage.value = Math.max(
    minimumYear.value,
    Math.min(maximumYear.value - 11, year.value - 5),
  )
}
function formatMode(date: string) {
  return props.mode === 'year'
    ? date.slice(0, 4)
    : props.mode === 'month'
      ? date.slice(0, 7)
      : props.mode === 'quarter'
        ? `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`
        : date
}
watch(open, (value) => {
  if (value) {
    initial()
  }
})
function allowed(value: string, mode: DateMode) {
  return periodAvailable(value, mode, props.min, props.max)
}
function move(delta: number) {
  if (view.value === 'year') {
    yearPage.value += delta * 12
    return
  }
  if (view.value !== 'date') {
    year.value += delta
    return
  }
  const date = calendarDate(year.value, month.value + delta)
  year.value = date.getUTCFullYear()
  month.value = date.getUTCMonth() + 1
}
const previousAllowed = computed(() =>
  view.value === 'year'
    ? yearPage.value > minimumYear.value
    : view.value === 'date'
      ? allowed(
          dateKey(calendarDate(year.value, month.value - 1)).slice(0, 7),
          'month',
        )
      : year.value > minimumYear.value,
)
const nextAllowed = computed(() =>
  view.value === 'year'
    ? yearPage.value + 11 < maximumYear.value
    : view.value === 'date'
      ? allowed(
          dateKey(calendarDate(year.value, month.value + 1)).slice(0, 7),
          'month',
        )
      : year.value < maximumYear.value,
)
function selectDay(value: string) {
  draft.value = value
  year.value = Number(value.slice(0, 4))
  month.value = Number(value.slice(5, 7))
}
function selectMonth(value: number) {
  month.value = value
  if (props.mode === 'month') {
    draft.value = `${year.value}-${String(value).padStart(2, '0')}`
  } else {
    view.value = 'date'
  }
}
function selectYear(value: number) {
  year.value = value
  if (props.mode === 'year') {
    draft.value = String(value)
  } else {
    view.value = props.mode === 'quarter' ? 'quarter' : 'month'
  }
}
function showYears() {
  yearPage.value = Math.max(
    minimumYear.value,
    Math.min(maximumYear.value - 11, year.value - 5),
  )
  view.value = 'year'
}
function chooseToday() {
  draft.value = formatMode(
    localDate() < props.min
      ? props.min
      : localDate() > props.max
        ? props.max
        : localDate(),
  )
  year.value = Number(draft.value.slice(0, 4))
  month.value =
    props.mode === 'quarter'
      ? (Number(draft.value.slice(-1)) - 1) * 3 + 1
      : Number(draft.value.slice(5, 7)) || 1
  view.value = props.mode
}
function confirm() {
  if (!canConfirm.value) {
    return
  }
  emit('update:modelValue', draft.value)
  emit('change', draft.value)
  open.value = false
}
function clear() {
  emit('update:modelValue', '')
  emit('change', '')
  open.value = false
}
async function arrows(event: KeyboardEvent) {
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
    event.key
  ]
  if (delta === undefined) {
    return
  }
  event.preventDefault()
  const container = event.currentTarget as HTMLElement
  const base = (event.target as HTMLElement).dataset.date || draft.value
  const date = calendarDate(
    Number(base.slice(0, 4)),
    Number(base.slice(5, 7)),
    Number(base.slice(8, 10)) + delta,
  )
  const key = dateKey(date)
  if (!allowed(key, 'date')) {
    return
  }
  selectDay(key)
  await nextTick()
  container.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus()
}
</script>

<template>
  <button
    type="button"
    class="date-sheet-trigger"
    :class="{ compact }"
    :aria-label="`${label}：${display}`"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :disabled="disabled"
    @click="open = true"
  >
    <span>{{ display }}</span><AppIcon name="calendar" :size="17" />
  </button><BottomSheet
    :open="open"
    :title="label"
    @close="open = false"
  >
    <div class="calendar-nav">
      <button
        type="button"
        class="icon-button"
        aria-label="上一页日期"
        :disabled="!previousAllowed"
        @click="move(-1)"
      >
        <AppIcon name="left" :size="20" />
      </button><button
        type="button"
        class="calendar-heading"
        :aria-label="view === 'date' ? '选择月份' : '选择年份'"
        @click="view === 'date' ? (view = 'month') : showYears()"
      >
        {{
          view === "date"
            ? `${year}年${month}月`
            : view === "year"
              ? `${yearPage}—${yearPage + 11}年`
              : `${year}年`
        }}<AppIcon name="down" :size="15" />
      </button><button
        type="button"
        class="icon-button"
        aria-label="下一页日期"
        :disabled="!nextAllowed"
        @click="move(1)"
      >
        <AppIcon name="right" :size="20" />
      </button>
    </div>
    <template v-if="view === 'date'">
      <div class="calendar-week" aria-hidden="true">
        <span
          v-for="day in ['日', '一', '二', '三', '四', '五', '六']"
          :key="day"
        >{{ day }}</span>
      </div>
      <div
        class="calendar-days"
        role="group"
        aria-label="选择日期"
        @keydown="arrows"
      >
        <button
          v-for="cell in cells"
          :key="cell.key"
          type="button"
          :data-date="cell.key"
          :class="{
            outside: !cell.inMonth,
            today: cell.key === localDate(),
            selected: cell.key === draft,
          }"
          :aria-label="cell.key"
          :aria-pressed="cell.key === draft"
          :disabled="!allowed(cell.key, 'date')"
          @click="selectDay(cell.key)"
        >
          {{ cell.day }}
        </button>
      </div>
    </template>
    <div v-else-if="view === 'month'" class="calendar-months">
      <button
        v-for="m in 12"
        :key="m"
        type="button"
        :disabled="!allowed(`${year}-${String(m).padStart(2, '0')}`, 'month')"
        :class="{
          selected:
            draft.slice(0, 7) === `${year}-${String(m).padStart(2, '0')}`,
        }"
        :aria-pressed="
          draft.slice(0, 7) === `${year}-${String(m).padStart(2, '0')}`
        "
        @click="selectMonth(m)"
      >
        {{ m }}月
      </button>
    </div>
    <div v-else-if="view === 'year'" class="calendar-months">
      <button
        v-for="y in years"
        :key="y"
        type="button"
        :disabled="y < minimumYear || y > maximumYear"
        :class="{ selected: Number(draft.slice(0, 4)) === y }"
        :aria-pressed="Number(draft.slice(0, 4)) === y"
        @click="selectYear(y)"
      >
        {{ y }}年
      </button>
    </div>
    <div v-else class="calendar-quarters">
      <button
        v-for="q in 4"
        :key="q"
        type="button"
        :class="{ selected: draft === `${year}-Q${q}` }"
        :aria-pressed="draft === `${year}-Q${q}`"
        :disabled="!allowed(`${year}-Q${q}`, 'quarter')"
        @click="draft = `${year}-Q${q}`"
      >
        <strong>第{{ q }}季度</strong><small>{{ (q - 1) * 3 + 1 }}月—{{ q * 3 }}月</small>
      </button>
    </div>
    <div class="calendar-extra">
      <button
        type="button"
        class="text-button"
        @click="chooseToday"
      >
        {{ mode === "date" ? "今天" : "当前期间" }}
      </button><span>{{ draft }}</span><button
        v-if="clearable"
        type="button"
        class="text-button"
        @click="clear"
      >
        清除日期
      </button>
    </div>
    <template #footer>
      <button
        type="button"
        class="button button-secondary"
        @click="open = false"
      > 取消</button><button
        type="button"
        class="button button-primary"
        :disabled="!canConfirm"
        @click="confirm"
      >
        确定
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.date-sheet-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 11px 12px;
  background: #fff;
  border: 1px solid #dce5e8;
  border-radius: 9px;
  color: #385363;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.date-sheet-trigger.compact {
  min-height: 36px;
  padding: 8px 10px;
  width: auto;
  font-size: 11px;
}
.date-sheet-trigger > svg {
  color: #8ca09f;
  flex-shrink: 0;
}
.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 15px;
}
.calendar-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  padding: 9px;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
}
.calendar-week,
.calendar-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
}
.calendar-week {
  font-size: 11px;
  color: #99a6ab;
  text-align: center;
  margin-bottom: 8px;
}
.calendar-week span {
  padding: 8px 0;
}
.calendar-days button {
  min-height: 42px;
  aspect-ratio: 1.12;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 12px;
  font: inherit;
  font-size: 14px;
  color: #435b67;
  padding: 0;
}
.calendar-days .outside {
  color: #b6c1c5;
}
.calendar-days .today {
  border-color: #b7d6ca;
  color: #137b72;
}
.calendar-days .selected,
.calendar-months .selected,
.calendar-quarters .selected {
  background: #137b72;
  color: white;
  border-color: #137b72;
}
.calendar-days button:hover:not(:disabled):not(.selected) {
  background: #edf5f2;
}
.calendar-days button:disabled,
.calendar-months button:disabled,
.calendar-quarters button:disabled {
  color: #d1d8da;
  opacity: 0.6;
}
.calendar-months {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.calendar-months button,
.calendar-quarters button {
  min-height: 58px;
  background: #f5f8f7;
  border: 1px solid transparent;
  border-radius: 11px;
  color: #435b67;
  font: inherit;
  font-size: 14px;
}
.calendar-quarters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.calendar-quarters button {
  padding: 20px;
}
.calendar-quarters strong {
  display: block;
  font-size: 14px;
  font-weight: 500;
}
.calendar-quarters small {
  display: block;
  margin-top: 8px;
  opacity: 0.7;
  font-size: 11px;
}
.calendar-extra {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #93a5a5;
  margin-top: 12px;
  gap: 8px;
}
.calendar-extra .text-button {
  font-size: 12px;
}
@media (max-width: 360px) {
  .calendar-days {
    gap: 3px;
  }
  .calendar-days button {
    min-height: 35px;
    font-size: 13px;
  }
}
</style>
