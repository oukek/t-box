<script setup lang="ts">
import type { CalendarEvent, CalendarEventInput, CalendarLunarDate } from '@t-box/calendar-contracts'
import {
  calendarColors,
  calendarKinds,
  calendarWeekdays,
  lunarToSolar,
  parseCalendarEvent,
  recurrenceOptions,
  solarToLunar,
} from '@t-box/calendar-contracts'
import { syncDeviceReminders } from '@t-box/device-reminders/client'
import { commonTimezones, dayjs, validDate } from '@t-box/time-contracts'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import TimeSheetField from '@t-box/ui-kit/TimeSheetField.vue'
import { computed, ref, toRaw, watch } from 'vue'
import { calendarApi } from './api'
import LunarDateSheetField from './LunarDateSheetField.vue'

const props = defineProps<{
  open: boolean
  event?: CalendarEvent
  date: string
  timezone: string
}>()
const emit = defineEmits<{ close: [], saved: [event: CalendarEvent] }>()
const draft = ref<CalendarEventInput>()
const startDate = ref('')
const endDate = ref('')
const startTime = ref('09:00')
const endTime = ref('10:00')
const busy = ref(false)
const error = ref('')
const repeatEnd = ref('')
watch(
  () => [props.open, props.event?.id],
  () => {
    if (!props.open) {
      return
    }
    const e = props.event
    draft.value = e
      ? structuredClone(toRaw(e))
      : {
          title: '',
          description: '',
          location: '',
          kind: 'event',
          color: 'teal',
          allDay: false,
          start: `${props.date}T09:00`,
          end: `${props.date}T10:00`,
          timezone: props.timezone,
          recurrence: {
            frequency: 'none',
            interval: 1,
            weekdays: [],
            until: null,
            monthPolicy: 'skip',
          },
          reminders: [],
        }
    const d = draft.value
    startDate.value = d.start.slice(0, 10)
    endDate.value = d.allDay
      ? dayjs.utc(d.end).subtract(1, 'day').format('YYYY-MM-DD')
      : d.end.slice(0, 10)
    startTime.value = d.allDay ? '09:00' : d.start.slice(11, 16)
    endTime.value = d.allDay ? '10:00' : d.end.slice(11, 16)
    repeatEnd.value = d.recurrence.until ?? ''
    error.value = ''
  },
  { immediate: true },
)
const zones = computed(() =>
  draft.value && !commonTimezones.some((z) => z.value === draft.value!.timezone)
    ? [
        { value: draft.value.timezone, label: draft.value.timezone },
        ...commonTimezones,
      ]
    : commonTimezones,
)
function calendarChanged(value: string) {
  if (!draft.value) {
    return
  }
  error.value = ''
  try {
    if (value === 'solar') {
      draft.value.lunar = null
    } else {
      const lunar = solarToLunar(startDate.value)
      lunarToSolar(lunar)
      draft.value.lunar = lunar
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '农历日期无效'
  }
}
function lunarChanged(value: CalendarLunarDate) {
  const next = lunarToSolar(value)
  const span = Math.max(
    0,
    dayjs.utc(endDate.value).diff(dayjs.utc(startDate.value), 'day'),
  )
  draft.value!.lunar = value
  startDate.value = next
  endDate.value = dayjs.utc(next).add(span, 'day').format('YYYY-MM-DD')
}
function reminderOptions(current: number) {
  const values = [0, 5, 15, 30, 60, 1440, 10080]
  if (!values.includes(current)) {
    values.push(current)
  }
  return values
    .sort((a, b) => a - b)
    .map((value) => ({
      value,
      label: value === 0 ? '开始时' : `提前 ${value} 分钟`,
      disabled: value !== current && draft.value!.reminders.includes(value),
    }))
}
function kindChanged(value: CalendarEventInput['kind']) {
  if (!draft.value) {
    return
  }
  draft.value.kind = value
  if (value === 'birthday' || value === 'anniversary') {
    draft.value.allDay = true
    draft.value.recurrence.frequency = 'yearly'
    draft.value.recurrence.monthPolicy = 'last_day'
  }
}
function weekday(value: number) {
  const r = draft.value!.recurrence
  r.weekdays = r.weekdays.includes(value)
    ? r.weekdays.filter((d) => d !== value)
    : [...r.weekdays, value]
}
async function save() {
  if (!draft.value) {
    return
  }
  error.value = ''
  try {
    const input = {
      ...toRaw(draft.value),
      start: draft.value.allDay
        ? startDate.value
        : `${startDate.value}T${startTime.value}`,
      end: draft.value.allDay
        ? dayjs.utc(validDate(endDate.value)).add(1, 'day').format('YYYY-MM-DD')
        : `${endDate.value}T${endTime.value}`,
      recurrence: {
        ...toRaw(draft.value.recurrence),
        until: repeatEnd.value || null,
      },
      reminders: [...draft.value.reminders],
    }
    const { id, revision, createdAt, updatedAt, ...clean } =
      input as CalendarEvent
    const parsed = parseCalendarEvent(clean)
    busy.value = true
    const result = props.event
      ? await calendarApi.update(props.event, parsed)
      : await calendarApi.create(parsed)
    void syncDeviceReminders(true)
    emit('saved', result.data)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal
    :open="open"
    :title="event ? '编辑整个事件' : '新建日历事件'"
    :busy="busy"
    @close="emit('close')"
  >
    <form
      v-if="draft"
      class="temporal-editor"
      @submit.prevent="save"
    >
      <fieldset :disabled="busy">
        <label class="temporal-field">标题<input
          v-model="draft.title"
          aria-label="事件标题"
          maxlength="100"
          placeholder="要记住什么？"
          autofocus
        ></label>
        <div class="temporal-field-grid">
          <label class="temporal-field">类型<SheetSelect
            :model-value="draft.kind"
            :options="calendarKinds"
            label="事件类型"
            @update:model-value="kindChanged"
          /></label><label class="temporal-field">颜色<SheetSelect
            v-model="draft.color"
            :options="calendarColors"
            label="事件颜色"
          /></label>
        </div>
        <label class="temporal-switch"><input v-model="draft.allDay" type="checkbox">全天事件</label>
        <label class="temporal-field">日期类型<SheetSelect
          :model-value="draft.lunar ? 'lunar' : 'solar'"
          :options="[
            { value: 'solar', label: '公历' },
            { value: 'lunar', label: '农历' },
          ]"
          label="事件日期类型"
          @update:model-value="calendarChanged"
        /></label>
        <div class="temporal-field-grid">
          <label class="temporal-field">{{ draft.lunar ? "农历开始日期" : "开始日期"
          }}<LunarDateSheetField
            v-if="draft.lunar"
            :model-value="draft.lunar"
            label="事件农历日期"
            @update:model-value="lunarChanged"
          /><DateSheetField
            v-else
            v-model="startDate"
            label="事件开始日期"
          /></label><label class="temporal-field">结束日期{{ draft.allDay ? "（包含当天）" : ""
          }}<DateSheetField
            v-model="endDate"
            label="事件结束日期"
            :min="startDate"
          /></label><template v-if="!draft.allDay">
            <label class="temporal-field">开始时间<TimeSheetField
              v-model="startTime"
              label="事件开始时间"
            /></label><label class="temporal-field">结束时间<TimeSheetField
              v-model="endTime"
              label="事件结束时间"
            /></label>
          </template>
        </div>
        <p v-if="draft.lunar" class="temporal-note">
          对应公历
          {{
            startDate
          }}；结束日期按公历设置。每年重复按农历月日，每月重复按实际农历月份（包含闰月）。
        </p>
        <label class="temporal-field">时区<SheetSelect
          v-model="draft.timezone"
          :options="zones"
          label="事件时区"
        /></label>
        <div class="temporal-field-grid">
          <label class="temporal-field">重复规则<SheetSelect
            v-model="draft.recurrence.frequency"
            :options="recurrenceOptions"
            label="重复规则"
          /></label>
          <div class="temporal-field calendar-reminder-fields">
            提醒（最多 3 次）
            <div
              v-for="(offset, index) in draft.reminders"
              :key="index"
              class="temporal-inline"
            >
              <SheetSelect
                :model-value="offset"
                :label="`第 ${index + 1} 次提醒`"
                :options="reminderOptions(offset)"
                @update:model-value="draft!.reminders[index] = $event"
              /><button
                type="button"
                class="temporal-text-button"
                :aria-label="`移除第 ${index + 1} 次提醒`"
                @click="draft.reminders.splice(index, 1)"
              >
                移除
              </button>
            </div>
            <button
              v-if="draft.reminders.length < 3"
              type="button"
              class="temporal-text-button"
              @click="
                draft.reminders.push(
                  [0, 15, 1440].find((n) => !draft!.reminders.includes(n))!,
                )
              "
            >
              {{ draft.reminders.length ? "再添加一次" : "添加提醒" }}
            </button>
          </div>
        </div>
        <template v-if="draft.recurrence.frequency !== 'none'">
          <div class="temporal-field-grid">
            <label class="temporal-field">每隔多少周期<input
              v-model.number="draft.recurrence.interval"
              inputmode="numeric"
              aria-label="重复间隔"
            ></label><label class="temporal-field">重复截止（可留空）<DateSheetField
              v-model="repeatEnd"
              label="重复截止日期"
              clearable
              :min="startDate"
            /></label>
          </div>
          <div
            v-if="draft.recurrence.frequency === 'weekly'"
            class="temporal-weekdays"
            aria-label="每周重复日期"
          >
            <button
              v-for="day in calendarWeekdays"
              :key="day.value"
              type="button"
              :aria-pressed="draft.recurrence.weekdays.includes(day.value)"
              @click="weekday(day.value)"
            >
              {{ day.label }}
            </button>
          </div>
          <label
            v-if="['monthly', 'yearly'].includes(draft.recurrence.frequency)"
            class="temporal-field"
          >{{ draft.lunar ? "农历小月没有三十时" : "目标月份没有此日期时"
          }}<SheetSelect
            v-model="draft.recurrence.monthPolicy"
            label="缺失日期处理"
            :options="[
              { value: 'skip', label: '跳过该次' },
              { value: 'last_day', label: '使用当月最后一天' },
            ]"
          /></label>
          <label
            v-if="
              draft.lunar?.leapMonth && draft.recurrence.frequency === 'yearly'
            "
            class="temporal-field"
          >该年没有对应闰月时<SheetSelect
            v-model="draft.lunar.leapPolicy"
            label="闰月重复规则"
            :options="[
              { value: 'regular', label: '使用同名普通月' },
              { value: 'skip', label: '跳过该年' },
            ]"
          /></label>
        </template><label class="temporal-field">地点<input
          v-model="draft.location"
          aria-label="事件地点"
          maxlength="200"
          placeholder="可选"
        ></label><label class="temporal-field">备注<textarea
          v-model="draft.description"
          aria-label="事件备注"
          rows="3"
          maxlength="2000"
          placeholder="记录重要细节"
        />
        </label>
      </fieldset>
      <p v-if="event" class="temporal-note">
        修改标题和备注会保留单次状态；更改时间或重复规则会重置单次完成／跳过记录。
      </p>
      <p class="temporal-note">
        全天提醒在事件时区上午 9 点触发；请在提醒设置中检查设备权限。
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
          :disabled="busy"
          @click="emit('close')"
        > 取消</button><button
          type="submit"
          class="button button-primary"
          :disabled="busy"
        >
          {{ busy ? "保存中…" : "保存事件" }}
        </button>
      </div>
    </form>
  </Modal>
</template>
