<script setup lang="ts">
import type { CalendarEvent, CalendarException, CalendarOccurrence } from '@t-box/calendar-contracts'
import {
  calendarDayInfo,
  calendarKinds,
  calendarWeekdays,
  calendarWeekRange,
  calendarWeekStart,
  lunarEventLabel,
  lunarLabel,
} from '@t-box/calendar-contracts'
import { syncDeviceReminders } from '@t-box/device-reminders/deviceReminders'
import ReminderSettings from '@t-box/device-reminders/ReminderSettings.vue'
import { dayjs, timeSnapshot } from '@t-box/time-contracts'
import { AppIcon, Modal, SheetSelect } from '@t-box/ui-kit'
import { calendarCells } from '@t-box/ui-kit/calendar'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { calendarApi } from './api'
import CalendarBackup from './CalendarBackup.vue'
import CalendarEventEditor from './CalendarEventEditor.vue'
import { holidayYears, loadHolidayYears } from './holiday-cache'
import '@t-box/ui-kit/temporal.css'
import './calendar.css'

const props = defineProps<{
  date?: string
  view?: string
  eventId?: string
  openRevision?: number
}>()
const timezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
const today = () => timeSnapshot(timezone).date
const selected = ref(today())
const view = ref('month')
const occurrences = ref<CalendarOccurrence[]>([])
const events = ref<CalendarEvent[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const kind = ref('')
const truncated = ref(false)
const editorOpen = ref(false)
const editing = ref<CalendarEvent>()
const details = ref<CalendarOccurrence | null>(null)
const detailEvent = ref<CalendarEvent | null>(null)
const deleting = ref(false)
const deleteOpen = ref(false)
const mutationBusy = ref(false)

let loadVersion = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const year = computed(() => Number(selected.value.slice(0, 4)))
const month = computed(() => Number(selected.value.slice(5, 7)))
const cells = computed(() =>
  calendarCells(year.value, month.value).map((cell) => ({
    ...cell,
    info: calendarDayInfo(cell.key, holidayYears.value),
    weekend: dayjs.utc(cell.key).isoWeekday() >= 6,
  })),
)
const selectedInfo = computed(() =>
  calendarDayInfo(selected.value, holidayYears.value),
)
const holidayError = ref(false)
const holidayLoading = ref(false)
let holidayController: AbortController | undefined
async function loadHolidays(refresh = false) {
  holidayController?.abort()
  const controller = (holidayController = new AbortController())
  holidayLoading.value = true
  const ok = await loadHolidayYears(
    [year.value - 1, year.value, year.value + 1],
    controller.signal,
    refresh,
  )
  if (!controller.signal.aborted) {
    holidayError.value = !ok
    holidayLoading.value = false
  }
}
watch(
  year,
  () => {
    void loadHolidays()
  },
  { immediate: true },
)
const currentDate = computed(() => dayjs.utc(selected.value))
const range = computed(() =>
  view.value === 'anniversaries'
    ? {
        from: today(),
        to: dayjs.utc(today()).add(370, 'day').format('YYYY-MM-DD'),
      }
    : view.value === 'agenda'
      ? calendarWeekRange(selected.value)
      : {
          from:
            cells.value[0]!.key < '1900-01-01'
              ? '1900-01-01'
              : cells.value[0]!.key,
          to:
            cells.value[41]!.key.length !== 10 ||
            cells.value[41]!.key > '9999-12-31'
              ? '9999-12-31'
              : cells.value[41]!.key,
        },
)
const daily = computed(() =>
  occurrences.value.filter(
    (o) =>
      o.displayDate <= selected.value && o.displayEndDate >= selected.value,
  ),
)
const upcoming = computed(() =>
  occurrences.value
    .filter((o) => ['anniversary', 'birthday'].includes(o.event.kind))
    .filter(
      (o, index, all) =>
        all.findIndex((other) => other.event.id === o.event.id) === index,
    ),
)
const weeks = computed(() =>
  Array.from({ length: 7 }, (_, i) =>
    dayjs
      .utc(calendarWeekStart(selected.value))
      .add(i, 'day')
      .format('YYYY-MM-DD')),
)
const countByDate = computed(() => {
  const result = new Map<string, CalendarOccurrence[]>()
  for (const cell of cells.value) {
    result.set(
      cell.key,
      occurrences.value.filter(
        (o) => o.displayDate <= cell.key && o.displayEndDate >= cell.key,
      ),
    )
  }
  return result
})
const selectedLabel = computed(
  () =>
    `${currentDate.value.month() + 1}月${currentDate.value.date()}日 · 星期${['一', '二', '三', '四', '五', '六', '日'][currentDate.value.isoWeekday() - 1]}`,
)
const displayedEvent = computed(
  () => detailEvent.value ?? details.value?.event ?? null,
)
const singleStates = ref<CalendarException[]>([])
let detailVersion = 0
watch(
  () => displayedEvent.value?.id,
  async (id) => {
    const version = ++detailVersion
    singleStates.value = []
    if (!id) {
      return
    }
    try {
      const response = await calendarApi.states(id)
      if (version === detailVersion) {
        singleStates.value = response.data
      }
    } catch (cause) {
      if (version === detailVersion) {
        error.value =
          cause instanceof Error ? cause.message : '单次状态读取失败'
      }
    }
  },
)
async function restoreOccurrence(date: string) {
  const event = displayedEvent.value
  if (!event) {
    return
  }
  mutationBusy.value = true
  try {
    await calendarApi.state(event, date, 'normal')
    detailEvent.value = (await calendarApi.get(event.id)).data
    singleStates.value = (await calendarApi.states(event.id)).data
    await load()
    if (details.value) {
      details.value =
        occurrences.value.find(
          (o) =>
            o.event.id === event.id &&
            o.occurrenceDate === details.value?.occurrenceDate,
        ) ?? null
    }
    void syncDeviceReminders(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '恢复失败'
  } finally {
    mutationBusy.value = false
  }
}
function move(delta: number) {
  const d = currentDate.value.add(
    delta,
    view.value === 'agenda' ? 'week' : 'month',
  )
  if (d.year() >= 1900 && d.year() <= 9999) {
    selected.value = d.format('YYYY-MM-DD')
  }
}
function timeLabel(o: CalendarOccurrence) {
  if (o.event.allDay) {
    return '全天'
  }
  return dayjs(o.startAt).tz(timezone).format('HH:mm')
}
function daysUntil(o: CalendarOccurrence) {
  return dayjs.utc(o.displayDate).diff(dayjs.utc(today()), 'day')
}
function open(o: CalendarOccurrence) {
  details.value = o
  detailEvent.value = null
  error.value = ''
}
function newEvent() {
  editing.value = undefined
  editorOpen.value = true
}
function edit() {
  if (!displayedEvent.value) {
    return
  }
  editing.value = displayedEvent.value
  detailEvent.value = null
  details.value = null
  editorOpen.value = true
}
async function load() {
  const ticket = ++loadVersion
  loading.value = true
  error.value = ''
  try {
    const [result, list] = await Promise.all([
      calendarApi.occurrences(
        range.value.from,
        range.value.to,
        timezone,
        search.value,
        kind.value,
      ),
      calendarApi.events(search.value),
    ])
    if (ticket !== loadVersion) {
      return
    }
    occurrences.value = result.data.occurrences
    events.value = list.data
    truncated.value = result.data.truncated
  } catch (cause) {
    if (ticket === loadVersion) {
      error.value = cause instanceof Error ? cause.message : '日历读取失败'
    }
  } finally {
    if (ticket === loadVersion) {
      loading.value = false
    }
  }
}
watch(
  () => [selected.value, view.value, kind.value],
  () => {
    void load()
  },
)
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
})
watch(
  () => [props.date, props.view, props.eventId, props.openRevision],
  async () => {
    selected.value = props.date ?? today()
    view.value = props.view ?? 'month'
    await load()
    if (props.eventId) {
      try {
        detailEvent.value = (await calendarApi.get(props.eventId)).data
        details.value =
          occurrences.value.find((o) => o.event.id === props.eventId) ?? null
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '读取事件失败'
      }
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  holidayController?.abort()
  loadVersion++
  clearTimeout(searchTimer)
})
async function saved(event: CalendarEvent) {
  editorOpen.value = false
  if (['birthday', 'anniversary'].includes(event.kind)) {
    view.value = 'anniversaries'
    selected.value = today()
  } else {
    selected.value = event.start.slice(0, 10)
  }
  await load()
}
async function setState(state: 'completed' | 'normal' | 'skipped') {
  if (!details.value) {
    return
  }
  mutationBusy.value = true
  try {
    await calendarApi.state(
      displayedEvent.value ?? details.value.event,
      details.value.occurrenceDate,
      state,
    )
    details.value = null
    detailEvent.value = null
    await load()
    void syncDeviceReminders(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '修改失败'
  } finally {
    mutationBusy.value = false
  }
}
async function remove() {
  if (!displayedEvent.value) {
    return
  }
  deleting.value = true
  try {
    await calendarApi.remove(displayedEvent.value)
    deleteOpen.value = false
    details.value = null
    detailEvent.value = null
    await load()
    void syncDeviceReminders(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除失败'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="temporal-page calendar-page">
    <div class="temporal-toolbar">
      <nav class="temporal-tabs" aria-label="日历视图">
        <button
          v-for="item in [
            { id: 'month', title: '月历' },
            { id: 'agenda', title: '周日程' },
            { id: 'anniversaries', title: '纪念日' },
          ]"
          :key="item.id"
          :aria-pressed="view === item.id"
          @click="view = item.id"
        >
          {{ item.title }}
        </button>
      </nav>
      <button class="temporal-primary" @click="newEvent">
        <AppIcon name="plus" :size="16" /><span>新建</span>
      </button>
    </div>
    <div class="calendar-tools">
      <label class="calendar-search"><AppIcon name="search" :size="16" /><input
        v-model="search"
        aria-label="搜索日历事件"
        placeholder="搜索标题、地点、备注"
      ></label><SheetSelect
        v-model="kind"
        :options="[{ value: '', label: '全部类型' }, ...calendarKinds]"
        label="筛选事件类型"
      /><button
        class="icon-button"
        aria-label="刷新日历"
        :disabled="loading"
        @click="
          load();
          loadHolidays(true);
        "
      >
        <AppIcon name="refresh" :size="18" />
      </button>
    </div>
    <p
      v-if="error"
      class="temporal-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="holidayError"
      class="temporal-note"
      role="status"
    >
      节假日更新失败；已缓存的安排仍可查看。请稍后刷新。
    </p>
    <p v-if="truncated" class="temporal-note">
      日程较多，仅展示前 5000 次；请缩小查询范围。
    </p>
    <div v-if="view !== 'anniversaries'" class="calendar-period">
      <div>
        <button
          class="icon-button"
          aria-label="上一个期间"
          @click="move(-1)"
        >
          <AppIcon name="left" :size="20" />
        </button><DateSheetField
          :model-value="selected.slice(0, 7)"
          mode="month"
          label="选择日历月份"
          compact
          @update:model-value="selected = `${$event}-01`"
        /><button
          class="icon-button"
          aria-label="下一个期间"
          @click="move(1)"
        >
          <AppIcon name="right" :size="20" />
        </button>
      </div>
      <button class="temporal-text-button" @click="selected = today()">
        今天
      </button>
    </div>
    <div v-if="view === 'month'" class="calendar-layout">
      <div class="calendar-month">
        <div class="calendar-week-labels">
          <span v-for="day in calendarWeekdays" :key="day.value">{{
            day.label
          }}</span>
        </div>
        <div
          class="calendar-grid"
          role="group"
          aria-label="月历日期"
        >
          <button
            v-for="cell in cells"
            :key="cell.key"
            class="calendar-day"
            :class="{
              outside: !cell.inMonth,
              today: cell.key === today(),
              selected: cell.key === selected,
              weekend: cell.weekend,
            }"
            :aria-label="
              [
                cell.key,
                cell.info.lunar ? `农历${cell.info.lunar.label}` : '',
                ...cell.info.festivals,
                cell.info.solarTerm,
                cell.info.arrangement
                  ? cell.info.arrangement.status === 'rest'
                    ? '放假'
                    : '调休上班'
                  : '',
                `${countByDate.get(cell.key)?.length || 0}个日程`,
              ]
                .filter(Boolean)
                .join('，')
            "
            :aria-pressed="cell.key === selected"
            :disabled="cell.key < '1900-01-01' || cell.key > '9999-12-31'"
            @click="selected = cell.key"
          >
            <span
              v-if="cell.info.arrangement"
              class="calendar-day-mark"
              :class="cell.info.arrangement.status"
              aria-hidden="true"
            >{{ cell.info.arrangement.status === "rest" ? "休" : "班" }}</span>
            <strong>{{ cell.day }}</strong><small
              :class="`label-${cell.info.labelKind}`"
              :title="
                cell.info.festivals.join('、')
                  || cell.info.solarTerm
                  || cell.info.lunar?.label
              "
            >{{ cell.info.label }}</small><span class="calendar-dots"><i
              v-for="o in countByDate.get(cell.key)?.slice(0, 3)"
              :key="`${o.event.id}:${o.occurrenceDate}`"
              :class="`color-${o.event.color}`"
            /></span>
          </button>
        </div>
        <div class="calendar-legend">
          <span><i class="rest">休</i>放假</span><span><i class="work">班</i>调休上班</span><span class="calendar-legend-note">{{
            selectedInfo.scheduleKnown
              ? "中国大陆放假调休安排"
              : holidayLoading
                ? "正在更新节假日…"
                : `${year} 年安排尚未公布或未收录`
          }}</span>
        </div>
      </div>
      <aside class="calendar-day-agenda">
        <header>
          <h2>{{ selectedLabel }}</h2>
          <span>{{ daily.length }} 个日程</span>
        </header>
        <section
          class="calendar-almanac"
          aria-label="选中日期的农历与节假日信息"
        >
          <template v-if="selectedInfo.lunar">
            <div class="calendar-lunar-heading">
              <strong>农历{{ selectedInfo.lunar.label }}</strong><span>{{ selectedInfo.lunar.yearName
              }}{{ selectedInfo.lunar.zodiac }}年</span>
            </div>
            <div
              v-if="
                selectedInfo.festivals.length
                  || selectedInfo.solarTerm
                  || selectedInfo.arrangement
              "
              class="calendar-almanac-tags"
            >
              <span
                v-for="festival in selectedInfo.festivals"
                :key="festival"
                class="festival"
              >{{ festival }}</span>
              <span v-if="selectedInfo.solarTerm" class="term">{{
                selectedInfo.solarTerm
              }}</span>
              <span
                v-if="selectedInfo.arrangement"
                :class="selectedInfo.arrangement.status"
              >{{
                 selectedInfo.festivals.includes(selectedInfo.arrangement.name)
                   ? ""
                   : `${selectedInfo.arrangement.name} · `
               }}
                {{
                  selectedInfo.arrangement.status === "rest"
                    ? "放假"
                    : "调休上班"
                }}</span>
            </div>
            <p v-if="selectedInfo.nextSolarTerm" class="calendar-next-term">
              下个节气 <strong>{{ selectedInfo.nextSolarTerm.name }}</strong><span>{{
                selectedInfo.nextSolarTerm.date.slice(5).replace("-", "月")
              }}日 · {{ selectedInfo.nextSolarTerm.daysAway }}天后</span>
            </p>
          </template>
          <p v-else class="calendar-almanac-note">农历信息支持 1900–2100 年</p>
        </section>
        <p v-if="loading" class="temporal-empty">正在读取…</p>
        <p v-else-if="!daily.length" class="temporal-empty">
          留一点时间给自己。<button
            class="temporal-text-button"
            @click="newEvent"
          >
            添加这一天的日程
          </button>
        </p>
        <button
          v-for="o in daily"
          :key="`${o.event.id}:${o.occurrenceDate}`"
          class="calendar-occurrence"
          :class="[`color-${o.event.color}`, { completed: o.completed }]"
          @click="open(o)"
        >
          <span class="calendar-occurrence-time">{{ timeLabel(o) }}</span>
          <div>
            <strong>{{ o.event.title }}</strong><small>{{
              o.event.location
                || calendarKinds.find((k) => k.value === o.event.kind)?.label
            }}{{ o.completed ? " · 已完成" : "" }}</small>
          </div>
          <AppIcon name="right" :size="15" />
        </button>
      </aside>
    </div>
    <div v-else-if="view === 'agenda'" class="calendar-agenda-week">
      <section v-for="day in weeks" :key="day">
        <header>
          <h2>{{ day.slice(5).replace("-", "月") }}日</h2>
          <small>{{
            [
              lunarLabel(day),
              ...calendarDayInfo(day, holidayYears).festivals,
              calendarDayInfo(day, holidayYears).solarTerm,
            ]
              .filter(Boolean)
              .join(" · ")
          }}</small>
        </header>
        <p
          v-if="
            !occurrences.some(
              (o) => o.displayDate <= day && o.displayEndDate >= day,
            )
          "
          class="temporal-empty"
        >
          暂无日程
        </p>
        <button
          v-for="o in occurrences.filter(
            (o) => o.displayDate <= day && o.displayEndDate >= day,
          )"
          :key="`${o.event.id}:${o.occurrenceDate}`"
          class="calendar-occurrence"
          :class="[`color-${o.event.color}`, { completed: o.completed }]"
          @click="open(o)"
        >
          <span class="calendar-occurrence-time">{{ timeLabel(o) }}</span>
          <div>
            <strong>{{ o.event.title }}</strong><small>{{
              o.event.location || o.event.description || "未填写备注"
            }}</small>
          </div>
          <AppIcon name="right" :size="15" />
        </button>
      </section>
    </div>
    <div v-else class="calendar-anniversaries">
      <p class="temporal-note">
        未来一年内的生日与纪念日 · 按各事件的公历／农历规则计算
      </p>
      <button
        v-for="o in upcoming"
        :key="o.event.id"
        :class="`color-${o.event.color}`"
        @click="open(o)"
      >
        <div>
          <span>{{ o.event.kind === "birthday" ? "生日" : "纪念日"
          }}{{ o.event.lunar ? " · 农历" : "" }}</span><strong>{{ o.event.title }}</strong><small>{{ o.occurrenceDate
          }}{{
            o.anniversaryYears
              ? ` · ${o.anniversaryYears}${o.event.kind === "birthday" ? "周岁" : "周年"}`
              : ""
          }}</small>
        </div>
        <p>
          <strong>{{ daysUntil(o) === 0 ? "今天" : daysUntil(o) }}</strong><span v-if="daysUntil(o) !== 0">天后</span>
        </p>
      </button>
      <p v-if="!upcoming.length && !loading" class="temporal-empty">
        把值得记住的日子放在这里。
      </p>
    </div>
    <section v-if="search && events.length" class="calendar-search-results">
      <h2>匹配的事件</h2>
      <button
        v-for="event in events"
        :key="event.id"
        @click="
          detailEvent = event;
          details = occurrences.find((o) => o.event.id === event.id) ?? null;
        "
      >
        <strong>{{ event.title }}</strong><small>{{ event.lunar ? lunarEventLabel(event.lunar) : event.start }} ·
          {{ event.recurrence.frequency === "none" ? "单次" : "重复" }}</small>
      </button>
    </section>
    <ReminderSettings />
    <CalendarBackup @changed="load" />
    <CalendarEventEditor
      :open="editorOpen"
      :event="editing"
      :date="selected"
      :timezone="timezone"
      @close="editorOpen = false"
      @saved="saved"
    /><Modal
      :open="!!displayedEvent && !deleteOpen"
      title="事件详情"
      :busy="mutationBusy"
      @close="
        details = null;
        detailEvent = null;
      "
    >
      <template v-if="displayedEvent">
        <span class="temporal-badge">{{
          calendarKinds.find((k) => k.value === displayedEvent?.kind)?.label
        }}</span>
        <h3 class="calendar-detail-title">
          {{ displayedEvent.title }}
        </h3>
        <dl class="temporal-detail">
          <div v-if="displayedEvent.lunar">
            <dt>农历日期</dt>
            <dd>
              {{ lunarEventLabel(displayedEvent.lunar)
              }}<template v-if="details">
                · 本次{{ lunarLabel(details.occurrenceDate) }}
              </template>
            </dd>
          </div>
          <div>
            <dt>日期时间</dt>
            <dd>
              {{ details ? details.occurrenceDate : displayedEvent.start
              }}{{
                displayedEvent.allDay
                  ? " · 全天"
                  : ` · ${displayedEvent.start.slice(11)}—${displayedEvent.end.slice(11)}`
              }}
            </dd>
          </div>
          <div>
            <dt>时区</dt>
            <dd>{{ displayedEvent.timezone }}</dd>
          </div>
          <div v-if="displayedEvent.location">
            <dt>地点</dt>
            <dd>{{ displayedEvent.location }}</dd>
          </div>
          <div>
            <dt>重复</dt>
            <dd>
              {{
                displayedEvent.recurrence.frequency === "none"
                  ? "单次事件"
                  : `每 ${displayedEvent.recurrence.interval} ${{ daily: "天", weekly: "周", monthly: "月", yearly: "年" }[displayedEvent.recurrence.frequency]}`
              }}
              <template
                v-if="
                  displayedEvent.lunar
                    && ['monthly', 'yearly'].includes(
                      displayedEvent.recurrence.frequency,
                    )
                "
              >（农历{{
                displayedEvent.recurrence.monthPolicy === "last_day"
                  ? "，小月用最后一天"
                  : "，缺失日期跳过"
              }}{{
                displayedEvent.lunar.leapMonth
                  && displayedEvent.recurrence.frequency === "yearly"
                  ? displayedEvent.lunar.leapPolicy === "regular"
                    ? "，无闰月用普通月"
                    : "，无闰月跳过"
                  : ""
              }}）</template>
            </dd>
          </div>
          <div v-if="displayedEvent.description">
            <dt>备注</dt>
            <dd>{{ displayedEvent.description }}</dd>
          </div>
          <div>
            <dt>提醒设置</dt>
            <dd>
              {{
                displayedEvent.reminders.length
                  ? displayedEvent.reminders
                    .map((n) => (n === 0 ? "开始时" : `提前 ${n} 分钟`))
                    .join("、")
                  : "不提醒"
              }}
            </dd>
          </div>
        </dl>
        <p
          v-if="error"
          class="temporal-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div v-if="details" class="calendar-occurrence-actions">
          <button
            class="temporal-text-button"
            :disabled="mutationBusy"
            @click="setState(details.completed ? 'normal' : 'completed')"
          >
            {{ details.completed ? "恢复未完成" : "完成这一次" }}
          </button><button
            v-if="displayedEvent.recurrence.frequency !== 'none'"
            class="temporal-text-button"
            :disabled="mutationBusy"
            @click="setState('skipped')"
          >
            跳过这一次
          </button>
        </div>
        <details v-if="singleStates.length" class="calendar-backup">
          <summary>
            已完成 / 跳过的单次日程（{{ singleStates.length }}）
          </summary>
          <div
            v-for="state in singleStates"
            :key="state.date"
            class="temporal-inline"
          >
            <span>{{ state.date }} ·
              {{ state.state === "skipped" ? "已跳过" : "已完成" }}</span><button
              class="temporal-text-button"
              :disabled="mutationBusy"
              @click="restoreOccurrence(state.date)"
            >
              恢复
            </button>
          </div>
        </details>
        <div class="temporal-actions">
          <button
            class="button button-secondary"
            :disabled="mutationBusy"
            @click="edit"
          > 编辑整个事件</button><button
            class="button button-danger"
            :disabled="mutationBusy"
            @click="deleteOpen = true"
          >
            删除
          </button>
        </div>
      </template>
    </Modal><Modal
      :open="deleteOpen"
      title="删除整个事件"
      :busy="deleting"
      @close="deleteOpen = false"
    >
      <p class="temporal-note">
        删除“{{ displayedEvent?.title }}”及全部重复日程？此操作不能撤销。
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
          :disabled="deleting"
          @click="deleteOpen = false"
        > 取消</button><button
          class="button button-danger"
          :disabled="deleting"
          @click="remove"
        >
          确认删除
        </button>
      </div>
    </Modal>
  </section>
</template>
