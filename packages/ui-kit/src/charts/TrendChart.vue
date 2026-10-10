<script setup lang="ts">
import type { TrendPoint } from './data'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatMoney } from '../decimal'

const props = withDefaults(
  defineProps<{
    points: readonly TrendPoint[]
    incomeLabel?: string
    expenseLabel?: string
  }>(),
  { incomeLabel: '收入', expenseLabel: '支出' },
)
const emit = defineEmits<{ select: [start: string, end: string] }>()
const container = ref<HTMLElement>()
const width = ref(600)
const selection = ref('')
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(
    (entries) =>
      (width.value = Math.max(240, entries[0]?.contentRect.width || 600)),
  )
  if (container.value) {
    observer.observe(container.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
const limits = computed(() => {
  const values = props.points.flatMap((row) => [
    Number(row.income),
    Number(row.expense),
  ])
  return { max: Math.max(1, ...values), min: Math.min(0, ...values) }
})
const y = (amount: number) =>
  20 +
  ((limits.value.max - amount) / (limits.value.max - limits.value.min)) * 145
const baseline = computed(() => y(0))
const slotWidth = computed(
  () => (width.value - 52) / Math.max(1, props.points.length),
)
const barWidth = computed(() =>
  Math.max(1, Math.min(14, slotWidth.value * 0.3)),
)
const labelStep = computed(() =>
  Math.max(
    1,
    Math.ceil(
      props.points.length / Math.max(2, Math.floor((width.value - 52) / 55)),
    ),
  ),
)
const active = computed(() =>
  props.points.find((row) => row.start === selection.value),
)
const nonempty = computed(() =>
  props.points.some((row) => Number(row.income) || Number(row.expense)),
)
function height(amount: string) {
  return Math.abs(y(Number(amount)) - baseline.value)
}
function choose(point: TrendPoint) {
  selection.value = point.start
  emit('select', point.start, point.end)
}
function axis(value: number) {
  return value >= 10000
    ? `${Number((value / 10000).toFixed(1))}万`
    : value >= 1000
      ? `${Number((value / 1000).toFixed(1))}千`
      : String(Number(value.toFixed(2)))
}
</script>

<template>
  <div ref="container" class="trend-visual">
    <div class="chart-legend">
      <span><i class="income-key" />{{ incomeLabel }}</span><span><i class="expense-key" />{{ expenseLabel }}</span><small>单位：元</small>
    </div>
    <svg
      :viewBox="`0 0 ${width} 215`"
      class="trend-svg"
      :aria-label="`${incomeLabel}与${expenseLabel}趋势，可选择日期查看明细`"
    >
      <g v-for="ratio in [1, 0.5, 0]" :key="ratio">
        <line
          x1="42"
          :x2="width - 10"
          :y1="20 + (1 - ratio) * 145"
          :y2="20 + (1 - ratio) * 145"
          stroke="#eaf0ef"
          stroke-dasharray="3 5"
        />
        <text
          x="34"
          :y="24 + (1 - ratio) * 145"
          text-anchor="end"
          class="chart-axis"
        >
          {{ axis(limits.max - (1 - ratio) * (limits.max - limits.min)) }}
        </text>
      </g>
      <line
        x1="42"
        :x2="width - 10"
        :y1="baseline"
        :y2="baseline"
        stroke="#cad9d4"
      />
      <g
        v-for="(point, index) in points"
        :key="point.start"
        role="button"
        tabindex="0"
        :aria-label="`${point.start}${point.end !== point.start ? '至' + point.end : ''}，${incomeLabel}${point.income}元，${expenseLabel}${point.expense}元，查看明细`"
        :aria-pressed="selection === point.start"
        class="chart-point"
        @click="choose(point)"
        @keydown.enter="choose(point)"
        @keydown.space.prevent="choose(point)"
      >
        <rect
          :x="42 + index * slotWidth"
          y="10"
          :width="slotWidth"
          height="159"
          rx="4"
          :fill="selection === point.start ? '#edf5f2' : 'transparent'"
        />
        <rect
          :x="42 + index * slotWidth + slotWidth / 2 - barWidth - 1"
          :y="Math.min(baseline, y(Number(point.income)))"
          :width="barWidth"
          :height="height(point.income)"
          rx="2"
          fill="#137b72"
        />
        <rect
          :x="42 + index * slotWidth + slotWidth / 2 + 1"
          :y="Math.min(baseline, y(Number(point.expense)))"
          :width="barWidth"
          :height="height(point.expense)"
          rx="2"
          fill="#cf805f"
        />
        <text
          v-if="
            index % labelStep === 0
              || (index === points.length - 1
                && points.length > 1
                && index % labelStep > labelStep / 2)
          "
          :x="42 + index * slotWidth + slotWidth / 2"
          y="191"
          text-anchor="middle"
          class="chart-axis"
        >
          {{ point.label }}
        </text>
      </g>
    </svg>
    <p v-if="!nonempty" class="chart-empty">本期暂无记录，日期仍可选择。</p>
    <div
      v-if="active"
      class="chart-selection"
      aria-live="polite"
    >
      <span>{{ active.start
      }}{{ active.end !== active.start ? " — " + active.end : "" }}</span><strong>{{ incomeLabel }} {{ formatMoney(active.income) }}<br>{{
        expenseLabel
      }}
        {{ formatMoney(active.expense) }}</strong>
    </div>
    <p v-else class="chart-hint">点击柱状图，查看对应期间的明细。</p>
  </div>
</template>

<style scoped>
.trend-visual {
  min-width: 0;
}
.chart-legend {
  display: flex;
  align-items: center;
  gap: 18px;
  color: #879b9e;
  font-size: 11px;
  margin: 12px 0 6px;
}
.chart-legend > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chart-legend i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.income-key {
  background: #137b72;
}
.expense-key {
  background: #cf805f;
}
.chart-legend small {
  margin-left: auto;
  font-size: 10px;
  color: #a1afb0;
}
.trend-svg {
  width: 100%;
  display: block;
}
.chart-axis {
  fill: #9aa9ad;
  font-size: 10px;
  font-family: var(--number-font);
}
.chart-point {
  cursor: pointer;
  outline: none;
}
.chart-point:focus-visible > rect:first-child {
  stroke: var(--focus-border);
  stroke-width: 2;
}
.chart-point:hover > rect:first-child {
  fill: #edf5f2;
}
.chart-hint,
.chart-empty {
  font-size: 11px;
  color: #93a4a3;
  margin: 0;
  line-height: 1.8;
}
.chart-empty {
  margin-top: -8px;
  margin-bottom: 5px;
}
.chart-selection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 10px;
  color: #8a9c9e;
  min-height: 34px;
}
.chart-selection strong {
  font-size: 11px;
  font-weight: 500;
  color: #536b72;
  font-variant-numeric: tabular-nums;
  line-height: 1.8;
  text-align: right;
}
</style>
