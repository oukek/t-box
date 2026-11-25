<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { Item, Kind } from '@t-box/todo-contracts'
import {

  localDay,
  newItem,
  occurs,
  period,
  seriesAt,
  shift,
} from '@t-box/todo-contracts'
import { AppIcon, Modal } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Editor from './Editor.vue'
import Statistics from './Statistics.vue'
import { useItems } from './store'

const props = defineProps<{ client: AppClient }>()
const { rows, ready, busy, error, load, save } = useItems(props.client)
const tabs = ['我的待办', '循环清单', '长期计划', '统计']
const icons = ['task', 'refresh', 'ledger', 'calendar']
const tab = ref(0)
const filter = ref('今天')
const picked = ref('')
const detail = ref('')
const dateView = ref('')
const today = ref(localDay())
const editing = ref<Item | null>(null)
const baseRevision = ref(0)
const confirmPlan = ref(false)
const byId = computed(
  () => new Map(rows.value.filter((r) => !r.until).map((r) => [r.item.id, r])),
)
const items = computed(() => [...byId.value.values()].map((r) => r.item))
const series = computed(() => items.value.filter((x) => x.kind === 'list'))
const plans = computed(() => items.value.filter((x) => x.kind === 'plan'))
const selected = computed(() => byId.value.get(detail.value)?.item)
const revision = (x: Item) => byId.value.get(x.id)?.revision ?? 0
const clone = (x: Item): Item => JSON.parse(JSON.stringify(x))
const instant = () => new Date().toISOString()
function go(n: number) {
  tab.value = n
  detail.value = ''
  picked.value = ''
  filter.value = '今天'
  window.scrollTo(0, 0)
}
function open(x: Item, date = '') {
  detail.value = x.kind === 'period' ? x.series : x.id
  tab.value = x.kind === 'plan' ? 2 : 1
  dateView.value = date || x.scheduled || today.value
  window.scrollTo(0, 0)
}
function edit(x: Item) {
  error.value = ''
  editing.value = clone(x)
  baseRevision.value = revision(x)
}
function create() {
  const k: Kind = tab.value === 1 ? 'list' : tab.value === 2 ? 'plan' : 'task'
  edit(
    newItem(
      k,
      k === 'task' && filter.value === '未安排'
        ? ''
        : filter.value === '稍后' ? shift(today.value, 1) : picked.value || today.value,
    ),
  )
}
async function submit(x: Item) {
  if (await save(x, baseRevision.value)) {
    editing.value = null
    if (x.kind === 'list') {
      await load()
    }
    if (x.kind === 'list' || x.kind === 'plan') {
      openCollection(x)
    } else if (x.kind === 'task') {
      go(0)
      filter.value = x.done ? '已完成' : !x.date ? '未安排' : x.date > today.value ? '稍后' : '今天'
    }
  }
}
const history = computed(() =>
  rows.value
    .filter((r) => r.until)
    .sort((a, b) => a.until!.localeCompare(b.until!)),
)
const at = (s: Item, d: string) => seriesAt(s, history.value, d)
const scheduled = (s: Item, d: string) => occurs(at(s, d), d)
const periodAt = (s: Item, d: string) =>
  byId.value.get(s.id + '_' + d)?.item ?? period(at(s, d), d)
function nearest(s: Item, day: string) {
  const upper = day
  for (let i = 0; i <= 1600; i++) {
    const d = shift(upper, -i)
    if (
      d < s.date &&
      !history.value.some((h) => h.item.id === s.id && d >= h.item.date)
    ) {
      return ''
    }
    if (scheduled(s, d)) {
      return d
    }
  }
  return ''
}
const activePeriod = computed(() => {
  const s = selected.value
  if (s?.kind !== 'list') {
    return null
  }
  const day = dateView.value
  if (!day) {
    return null
  }
  if (byId.value.has(s.id + '_' + day) || scheduled(s, day)) {
    return periodAt(s, day)
  }
  return null
})
const detailItem = computed(() =>
  selected.value?.kind === 'plan' ? selected.value : activePeriod.value,
)
interface Line {
  key: string
  item: Item
  stepId?: string
  title: string
  date: string
  done: string
  meta: string
  urgent: boolean
}
function line(x: Item): Line {
  return {
    key: x.id,
    item: x,
    title: x.title,
    date: x.date,
    done: x.done,
    urgent: x.urgent,
    meta:
      x.kind === 'period'
        ? ruleText(byId.value.get(x.series)?.item) + ' · ' + progress(x)
        : x.origin || x.time || (x.due ? '截止 ' + x.due : '待办事项'),
  }
}
function ruleText(x?: Item) {
  const r = x?.rule
  if (!r) {
    return ''
  }
  return (
    '每' +
    (r.interval > 1 ? ' ' + r.interval + ' ' : '') +
    { day: '天', week: '周', month: '月' }[r.unit] +
    (r.unit === 'week'
      ? ' · ' + r.weekdays.map((n) => '周' + '日一二三四五六'[n]).join('、')
      : r.unit === 'month'
        ? r.lastDay
          ? ' · 月末'
          : ' · ' + Number(x!.date.slice(-2)) + ' 日'
        : '')
  )
}
function progress(x: Item) {
  return x.steps.length
    ? x.steps.filter((s) => s.done).length + ' / ' + x.steps.length + ' 项'
    : x.done
      ? '已完成'
      : '待处理'
}
const lines = computed(() => {
  const out: Line[] = []
  const periods = new Map<string, Item>()
  for (const x of items.value) {
    if (x.kind === 'task') {
      out.push(line(x))
    }
    if (x.kind === 'plan') {
      for (const s of x.steps) {
        if (s.done || (!x.done && !x.paused)) {
          out.push({
            key: x.id + s.id,
            item: x,
            stepId: s.id,
            title: s.title,
            date: s.date,
            done: s.done,
            urgent: !!s.urgent || x.urgent,
            meta: x.title,
          })
        }
      }
    }
    if (x.kind === 'period' && (x.done || x.date !== x.scheduled)) {
      periods.set(x.id, x)
    }
  }
  for (const s of series.value) {
    if (s.paused) {
      continue
    }
    const current = localDay(new Date(), s.rule!.zone)
    const last = nearest(s, current)
    const dates = new Set([last, picked.value])
    for (let i = 0; i < 7; i++) {
      dates.add(shift(today.value, i))
    }
    const nextStart = current < s.date ? s.date : shift(current, 1)
    for (let i = 0; i <= 1600; i++) {
      const d = shift(nextStart, i)
      if (s.end && d > s.end) {
        break
      }
      if (scheduled(s, d)) {
        dates.add(d)
        break
      }
    }
    for (const d of dates) {
      if (d && scheduled(s, d)) {
        const x = periodAt(s, d)
        periods.set(x.id, x)
      }
    }
  }
  for (const x of periods.values()) {
    if (!x.skipped) {
      out.push(line(x))
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      a.date.localeCompare(b.date) ||
      a.title.localeCompare(b.title, 'zh'),
  )
})
const currentDay = computed(() => picked.value || today.value)
const visible = computed(() =>
  lines.value.filter((l) => {
    if (filter.value === '已完成') {
      return !!l.done
    }
    if (l.done) {
      return false
    }
    if (filter.value === '未安排') {
      return !l.date
    }
    if (filter.value === '稍后') {
      return l.date > currentDay.value
    }
    if (picked.value) {
      return l.date === picked.value
    }
    return (
      (l.date && l.date <= currentDay.value) ||
      (!l.date && l.urgent) ||
      (!!l.item.due && l.item.due <= currentDay.value)
    )
  }),
)
function selectFilter(f: string) {
  filter.value = f
  picked.value = ''
}
async function change(x: Item, fn: (x: Item) => void) {
  const draft = clone(x)
  fn(draft)
  const saved = await save(draft, revision(x))
  if (saved && x.kind === 'list') {
    await load()
  }
  return saved
}
function toggleStep(x: Item, id: string) {
  return change(x, (v) => {
    const s = v.steps.find((s) => s.id === id)!
    s.done = s.done ? '' : instant()
    if (v.kind === 'period') {
      v.done = v.steps.every((s) => s.done) ? instant() : ''
    } else if (!s.done) {
      v.done = ''
    }
  })
}
function toggle(x: Item) {
  return change(x, (v) => {
    v.done = v.done ? '' : instant()
    if (v.kind === 'period') {
      for (const s of v.steps) {
        s.done = v.done
      }
    }
  })
}
function showLine(l: Line) {
  if (l.item.kind === 'task') {
    edit(l.item)
  } else {
    open(l.item, l.item.scheduled)
  }
}
async function carryStep(p: Item, id: string) {
  const source = p.steps.find((s) => s.id === id)
  if (!source) {
    return
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(p.id + id),
  )
  const hex = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
  const task = newItem('task', today.value)
  task.id = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
  const existing = byId.value.get(task.id)
  if (existing) {
    edit(existing.item)
    return
  }
  task.title = source.title
  task.origin = p.title + ' · ' + p.scheduled
  if (await save(task, 0)) {
    edit(task)
  }
}
function openCollection(s: Item) {
  open(
    s,
    s.kind === 'list'
      ? nearest(s, localDay(new Date(), s.rule!.zone)) || s.date
      : '',
  )
}
async function closePlan() {
  if (selected.value) {
    if (await toggle(selected.value)) {
      confirmPlan.value = false
    }
  }
}
const week = computed(() =>
  Array.from({ length: 7 }, (_, i) => shift(today.value, i)),
)
const metrics = computed(() => {
  const open = lines.value.filter(
    (l) => !l.done && !(l.item.kind === 'period' && l.date > today.value),
  )
  return [
    { name: '待处理', list: open },
    { name: '紧急待办', list: open.filter((l) => l.urgent) },
    { name: '已完成', list: lines.value.filter((l) => l.done) },
  ]
})
const metricIndex = ref(-1)
const stageProgress = computed(() => {
  const map = new Map<string, { done: number, total: number }>()
  for (const s of selected.value?.steps ?? []) {
    if (!s.stage) {
      continue
    }
    const count = map.get(s.stage) ?? { done: 0, total: 0 }
    count.total++
    if (s.done) {
      count.done++
    }
    map.set(s.stage, count)
  }
  return [...map.entries()]
})
const historyDays = computed(() => {
  const s = selected.value
  if (!s || s.kind !== 'list') {
    return []
  }
  const dates = new Set(
    items.value.filter((x) => x.series === s.id).map((x) => x.scheduled),
  )
  for (let i = 0; i < 90; i++) {
    const d = shift(today.value, -i)
    if (scheduled(s, d)) {
      dates.add(d)
    }
  }
  return [...dates].sort().reverse()
})
const clock = ref(new Date())
const dismissed = ref<string[]>([])
const reminders = computed(() =>
  lines.value.filter((l) => {
    const x = l.item
    if (l.done || !x.reminder || dismissed.value.includes(l.key) || l.stepId) {
      return false
    }
    const zone =
      x.kind === 'period'
        ? byId.value.get(x.series)?.item.rule?.zone
        : undefined
    const date = localDay(clock.value, zone)
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(clock.value)
    return x.date === date && (!x.time || time >= x.time)
  }),
)
function refresh() {
  clock.value = new Date()
  const d = localDay()
  today.value = d
  if (!document.hidden && !editing.value && !confirmPlan.value) {
    void load()
  }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  refresh()
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
  timer = setInterval(refresh, 60000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('focus', refresh)
  document.removeEventListener('visibilitychange', refresh)
})
</script>

<template>
  <header class="shell">
    <div class="brand"><span class="mark" />待办事项</div>
    <button class="host" @click="client.navigation.back()">‹ 方舟</button>
    <nav aria-label="主导航">
      <button
        v-for="(t, i) in tabs"
        :key="t"
        :class="{ active: tab === i }"
        @click="go(i)"
      >
        <AppIcon :name="icons[i]" />{{ t }}
      </button>
    </nav>
  </header>
  <main>
    <div
      v-if="error && !editing"
      class="notice"
      role="alert"
    >
      {{ error }} <button @click="load">重新读取</button>
    </div>
    <div
      v-for="r in reminders"
      :key="r.key"
      class="remind"
      role="status"
    >
      <button @click="showLine(r)">到时提醒 · {{ r.title }}</button><button @click="dismissed.push(r.key)">收起</button>
    </div>
    <p v-if="!ready">{{ busy ? "正在读取待办…" : "请连接方舟后读取待办" }}</p>
    <template v-else>
      <template v-if="!selected">
        <div class="heading">
          <div>
            <h1>{{ tabs[tab] }}</h1>
            <p>
              {{
                tab === 0
                  ? currentDay
                  : tab === 1
                    ? "共 " + series.length + " 份清单"
                    : tab === 2
                      ? "共 " + plans.length + " 个计划"
                      : "当前事项与未来七天"
              }}
            </p>
          </div>
          <button
            v-if="tab !== 3"
            class="primary"
            @click="create"
          >
            ＋ 新建
          </button>
        </div>
        <template v-if="tab === 0"><div class="switcher">
                                     <button
                                       v-for="f in ['今天', '稍后', '未安排', '已完成']"
                                       :key="f"
                                       :class="{ active: filter === f }"
                                       @click="selectFilter(f)"
                                     >
                                       {{ picked && f === "今天" ? "当日" : f }}
                                     </button>
                                   </div>
          <div class="section-head">
            <h2>{{ filter === "今天" ? "待处理" : filter }}</h2>
            <small>{{ visible.length }} 件</small>
          </div>
          <div
            v-for="l in visible"
            :key="l.key"
            class="row"
          >
            <button
              class="check"
              :class="{ done: l.done }"
              :disabled="busy"
              :aria-label="l.done ? '撤销完成' : '完成事项'"
              @click="
                l.item.kind === 'period'
                  ? showLine(l)
                  : l.stepId
                    ? toggleStep(l.item, l.stepId)
                    : toggle(l.item)
              "
            >
              {{ l.done ? "✓" : l.item.kind === "period" ? "↻" : "" }}</button><button class="text" @click="showLine(l)">
              <strong>{{ l.title }}</strong><small>{{ l.date && l.date !== today ? l.date + " · " : ""
              }}{{ l.meta }}</small></button><span v-if="l.urgent" class="urgent">紧急</span>
          </div>
          <p v-if="!visible.length" class="empty">
            {{ filter === "今天" ? "今天没有安排" : "这里暂时没有事项" }}
          </p></template>
        <template v-else-if="tab < 3"><button
                                        v-for="x in tab === 1 ? series : plans"
                                        :key="x.id"
                                        class="item-link"
                                        @click="openCollection(x)"
                                      >
                                        <span class="item-icon"><AppIcon :name="icons[tab]" /></span><span class="item-text"><strong>{{ x.title }}</strong><small>{{
                                          x.paused
                                            ? "已暂停"
                                            : x.done
                                              ? "已完成"
                                              : x.kind === "list"
                                                ? ruleText(x)
                                                : [x.date, x.end].filter(Boolean).join(" — ")
                                                  || "未安排日期"
                                        }}</small></span><small>{{
                                          x.kind === "plan" ? progress(x) : x.steps.length + " 个检查项"
                                        }}</small>
                                        ›
                                      </button>
          <p v-if="!(tab === 1 ? series : plans).length" class="empty">
            还没有{{ tab === 1 ? "循环清单" : "长期计划" }}，点「新建」添加。
          </p></template>
        <template v-else><div class="numbers">
                           <button
                             v-for="(m, i) in metrics"
                             :key="m.name"
                             class="metric"
                             @click="metricIndex = i"
                           >
                             {{ m.name }}<b>{{ m.list.length }}</b>
                           </button>
                         </div>
          <div class="columns">
            <section>
              <div class="section-head"><h2>未来七天安排</h2></div>
              <div class="chart">
                <button
                  v-for="d in week"
                  :key="d"
                  @click="
                    go(0);
                    picked = d;
                  "
                >
                  <b>{{
                    lines.filter((l) => !l.done && l.date === d).length
                  }}</b><i
                    :style="{
                      height:
                        Math.min(
                          85,
                          3
                            + lines.filter((l) => !l.done && l.date === d)
                              .length
                            * 10,
                        ) + 'px',
                    }"
                  /><small>{{ d.slice(-5) }}</small>
                </button>
              </div>
            </section>
            <section>
              <div class="section-head"><h2>计划进度</h2></div>
              <button
                v-for="x in plans"
                :key="x.id"
                class="side-link"
                @click="open(x)"
              >
                {{ x.title }} <small>{{ progress(x) }}</small>
              </button>
              <p v-if="!plans.length" class="empty">暂无计划</p>
            </section>
          </div>
          <div class="section-head"><h2>循环清单概览</h2></div>
          <button
            v-for="x in series"
            :key="x.id"
            class="side-link"
            @click="openCollection(x)"
          >
            {{ x.title }}<small>{{ x.paused ? "已暂停" : ruleText(x) }}</small>
          </button>
          <p v-if="!series.length" class="empty">暂无循环清单</p>
          <Statistics
            :records="rows"
            :forecast="week.map(d => ({ date: d, count: lines.filter(l => !l.done && l.date === d).length }))"
            :today="today"
          /></template>
      </template>
      <template v-else><button class="back" @click="go(tab)">‹ {{ tabs[tab] }}</button>
        <div class="heading">
          <div>
            <h1>{{ selected.title }}</h1>
            <p>
              {{
                selected.kind === "list"
                  ? ruleText(selected)
                  : [selected.date, selected.end].filter(Boolean).join(" — ")
              }}
            </p>
          </div>
          <button class="plain" @click="edit(selected)">编辑</button>
        </div>
        <div v-if="selected.kind === 'list'" class="tools">
          <label>查看期次 <input v-model="dateView" type="date"></label><button
            class="plain"
            :disabled="busy"
            @click="
              change(selected, (v) => {
                v.paused = !v.paused;
              })
            "
          >
            {{ selected.paused ? "恢复循环" : "暂停循环" }}
          </button>
        </div>
        <div v-if="selected.kind === 'plan' && stageProgress.length" class="stages"><small v-for="[name, count] in stageProgress" :key="name">{{ name }} · {{ count.done }} / {{ count.total }}</small></div>
        <template v-if="detailItem"><div class="section-head">
                                      <h2>{{ selected.kind === "list" ? "本期清单" : "子事项" }}</h2>
                                      <small>{{
                                        detailItem.skipped ? "已跳过" : progress(detailItem)
                                      }}</small>
                                    </div>
          <div class="sublist">
            <div
              v-for="s in detailItem.steps"
              :key="s.id"
              class="step-row"
            >
              <label :class="{ finished: s.done }"><input
                type="checkbox"
                :checked="!!s.done"
                :disabled="busy || detailItem.skipped"
                @change="toggleStep(detailItem, s.id)"
              >{{ s.title }} <small>{{ [s.stage, s.date].filter(Boolean).join(' · ') }}</small><span v-if="s.urgent" class="urgent">紧急</span></label><button
                v-if="detailItem.kind === 'period' && !s.done"
                :disabled="busy"
                @click="carryStep(detailItem, s.id)"
              >
                转待办
              </button>
            </div>
          </div>
          <div class="tools">
            <button
              v-if="selected.kind === 'plan' && !selected.done"
              class="plain"
              :disabled="busy"
              @click="
                change(selected, (v) => {
                  v.paused = !v.paused;
                })
              "
            >
              {{ selected.paused ? "恢复计划" : "暂停计划" }}</button><button
              v-if="selected.kind === 'plan'"
              class="plain"
              :disabled="busy"
              @click="
                !selected.done && selected.steps.some((s) => !s.done)
                  ? (confirmPlan = true)
                  : toggle(selected)
              "
            >
              {{ selected.done ? "重新打开计划" : "完成计划" }}</button><template v-else><button
              v-if="!detailItem.steps.length && !detailItem.skipped"
              class="plain"
              :disabled="busy"
              @click="toggle(detailItem)"
            >
              {{ detailItem.done ? "撤销完成" : "完成本次" }}</button><button
              v-if="!detailItem.done"
              class="plain"
              :disabled="busy"
              @click="
                change(detailItem, (v) => {
                  v.skipped = !v.skipped;
                })
              "
            >
              {{ detailItem.skipped ? "恢复本次" : "跳过本次" }}</button><button class="plain" @click="edit(detailItem)">
              调整本次安排
            </button></template>
          </div></template>
        <p v-else class="empty">
          {{ selected.paused ? "循环已暂停" : "所选日期没有安排" }}
        </p>
        <details v-if="selected.kind === 'list'">
          <summary>历史期次</summary>
          <button
            v-for="d in historyDays"
            :key="d"
            class="side-link"
            @click="dateView = d"
          >
            {{ d
            }}<small>{{
              periodAt(selected, d).skipped
                ? "已跳过"
                : progress(periodAt(selected, d))
            }}</small>
          </button>
        </details>
      </template></template>
  </main>
  <Editor
    v-if="editing"
    :value="editing"
    :busy="busy"
    :error="error"
    @close="
      editing = null;
      load();
    "
    @save="submit"
  />
  <Modal
    :open="confirmPlan"
    title="完成计划？"
    @close="confirmPlan = false"
  ><p>
     还有
     {{
       selected?.steps.filter((s) => !s.done).length
     }}
     项未做，结束后保留这些记录。
   </p>
    <template #footer><button @click="confirmPlan = false">取消</button><button
      class="primary"
      :disabled="busy"
      @click="closePlan"
    >
      结束计划
    </button></template></Modal>
  <Modal
    :open="metricIndex >= 0"
    :title="metrics[metricIndex]?.name || '明细'"
    @close="metricIndex = -1"
  ><button
     v-for="l in metrics[metricIndex]?.list"
     :key="l.key"
     class="side-link"
     @click="
       metricIndex = -1;
       showLine(l);
     "
   >
     {{ l.title }}<small>{{ l.meta }}</small>
   </button>
    <p v-if="!metrics[metricIndex]?.list.length">暂无事项</p></Modal>
</template>
