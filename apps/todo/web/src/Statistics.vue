<script setup lang="ts">
import type { Saved } from '@t-box/todo-contracts'

import {
  localDay,
  occurs,
  period,

  seriesAt,
  shift,
} from '@t-box/todo-contracts'
import { Modal } from '@t-box/ui-kit'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, ref } from 'vue'

const props = defineProps<{ records: Saved[], today: string, forecast: { date: string, count: number }[] }>()
const scope = ref('本周')
const customStart = ref(props.today)
const customEnd = ref(props.today)
const from = computed(() =>
  scope.value === '自选日期'
    ? customStart.value
    : scope.value === '本月'
      ? props.today.slice(0, 7) + '-01'
      : shift(props.today, -((new Date(props.today).getUTCDay() + 6) % 7)),
)
const end = computed(() =>
  scope.value === '自选日期' ? customEnd.value : props.today,
)
const valid = computed(
  () =>
    from.value &&
    end.value &&
    from.value <= end.value &&
    shift(from.value, 366) >= end.value,
)
interface Detail {
  label: string
  values: string[]
}
const detail = ref<Detail | null>(null)
const report = computed(() => {
  const values: Record<string, string[]> = {}
  function add(label: string, title: string) {
    (values[label] ??= []).push(title)
  }
  const inside = (d: string) =>
    valid.value && !!d && d >= from.value && d <= end.value
  const history = props.records
    .filter((r) => r.until)
    .sort((a, b) => a.until!.localeCompare(b.until!))
  const all = props.records.filter((r) => !r.until)
  const byId = new Map(all.map((r) => [r.item.id, r.item]))
  const completed = (stamp: string, title: string, kind: string) => {
    if (stamp) {
      const d = localDay(new Date(stamp))
      if (inside(d)) {
        add('完成事项', title)
        add(kind, title)
        add(d, title)
      }
    }
  }
  for (const { item: x, created } of all) {
    if (x.kind === 'task' && inside(localDay(new Date(created)))) {
      add('新增事项', x.title)
    }
    if (x.kind === 'task') {
      completed(x.done, x.title, '独立事项')
      if (!x.done && x.due && x.due < props.today) {
        add('已逾期', x.title)
      }
      if (!x.done && x.due >= props.today && x.due <= shift(props.today, 6)) {
        add('七天内截止', x.title)
      }
      if (!x.done && !x.date) {
        add('未安排日期', x.title)
      }
    } else if (x.kind === 'plan') {
      add(
        x.done ? '已结束计划' : x.paused ? '暂停计划' : '进行中计划',
        x.title,
      )
      if (x.done && inside(localDay(new Date(x.done)))) {
        add('期间结束计划', x.title)
      }
      for (const s of x.steps) {
        if (inside(localDay(new Date(s.created || created)))) {
          add('新增事项', x.title + ' · ' + s.title)
        }
        completed(s.done, x.title + ' · ' + s.title, '计划子事项')
        if (!x.paused && !x.done && !s.done && !s.date) {
          add('未安排日期', s.title)
        }
      }
    } else if (x.kind === 'period') {
      completed(x.done, x.title + ' · ' + x.scheduled, '循环期次')
    } else {
      add(x.paused ? '暂停清单' : '使用中清单', x.title)
      if (valid.value) {
        for (let day = from.value; day <= end.value; day = shift(day, 1)) {
          const s = seriesAt(x, history, day)
          const p = byId.get(x.id + '_' + day)
          if (!p && !occurs(s, day)) {
            continue
          }
          const entry = p ?? period(s, day)
          const name = entry.title + ' · ' + day
          add('应有期次', name)
          add(
            entry.skipped
              ? '明确跳过'
              : entry.done
                ? '整期完成'
                : entry.steps.some((s) => s.done)
                  ? '部分完成'
                  : '尚无勾选',
            name,
          )
        }
      }
    }
  }
  return values
})
const sections = [
  { title: '当前安排', labels: ['未安排日期', '已逾期', '七天内截止'] },
  {
    title: '期间变化',
    labels: ['新增事项', '完成事项', '独立事项', '计划子事项', '循环期次'],
  },
  {
    title: '循环清单',
    labels: [
      '使用中清单',
      '暂停清单',
      '应有期次',
      '整期完成',
      '部分完成',
      '明确跳过',
      '尚无勾选',
    ],
  },
  { title: '长期计划', labels: ['进行中计划', '暂停计划', '期间结束计划'] },
]
</script>

<template>
  <section class="stat-report">
    <p v-if="forecast.some(d => d.count)" class="cap">未来七天有 {{ forecast.filter(d => d.count).length }} 天安排了事项，最多的是 {{ forecast.filter(d => d.count === Math.max(...forecast.map(v => v.count))).map(d => d.date.slice(5)).join('、') }}（{{ Math.max(...forecast.map(v => v.count)) }} 件）。</p>
    <div class="section-head"><h2>统计明细</h2></div>
    <div class="switcher">
      <button
        v-for="s in ['本周', '本月', '自选日期']"
        :key="s"
        :class="{ active: s === scope }"
        @click="scope = s"
      >
        {{ s }}
      </button>
    </div>
    <div v-if="scope === '自选日期'" class="tools">
      <DateSheetField v-model="customStart" label="开始日期" /> 至
      <DateSheetField v-model="customEnd" label="结束日期" />
    </div>
    <p class="cap">
      {{ valid ? from + " 至 " + end : "请选择一年以内的日期范围" }}
    </p>
    <details v-if="valid"><summary>每日完成量</summary><button
      v-for="d in Object.keys(report).filter(k => /^\d{4}-/.test(k)).sort().reverse()"
      :key="d"
      class="side-link"
      @click="detail = { label: d, values: report[d] || [] }"
    >{{ d }}<small>{{ report[d]?.length }} 件</small></button><p v-if="!report['完成事项']?.length">所选期间没有完成记录。</p></details>
    <details v-for="g in sections" :key="g.title">
      <summary>{{ g.title }}</summary>
      <button
        v-for="label in g.labels"
        :key="label"
        class="side-link"
        @click="detail = { label, values: report[label] || [] }"
      >
        {{ label }}<small>{{ report[label]?.length || 0 }} ›</small>
      </button>
    </details>
  </section>
  <Modal
    :open="!!detail"
    :title="detail?.label || '明细'"
    @close="detail = null"
  ><p v-if="!detail?.values.length" class="empty">暂无记录</p>
    <p v-for="(title, i) in detail?.values" :key="i">{{ title }}</p></Modal>
</template>
