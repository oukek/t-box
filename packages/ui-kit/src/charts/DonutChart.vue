<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney } from '../decimal'
import { categorySlices } from './data'

const props = defineProps<{
  rows: readonly { label: string, amount: string, count: number }[]
  label: string
}>()
const slices = computed(() => {
  let offset = 0
  return categorySlices(props.rows).map((row) => {
    const result = { ...row, offset }
    offset += row.percentage
    return result
  })
})
</script>

<template>
  <div v-if="slices.length" class="category-visual">
    <svg
      viewBox="0 0 180 180"
      class="donut-svg"
      role="img"
      :aria-label="`${label}分类占比：${slices.map((row) => `${row.label} ${row.percentage.toFixed(1)}%`).join('，')}`"
    >
      <circle
        cx="90"
        cy="90"
        r="65"
        fill="none"
        stroke="#f0f4f2"
        stroke-width="18"
      />
      <g transform="rotate(-90 90 90)">
        <circle
          v-for="row in slices"
          :key="row.label"
          cx="90"
          cy="90"
          r="65"
          pathLength="100"
          fill="none"
          :stroke="row.color"
          stroke-width="18"
          :stroke-dasharray="`${Math.max(0, row.percentage - (slices.length > 1 ? 0.8 : 0))} ${100 - row.percentage + (slices.length > 1 ? 0.8 : 0)}`"
          :stroke-dashoffset="-row.offset"
        >
          <title>
            {{ row.label }}：{{ formatMoney(row.amount) }}元，{{
              row.percentage.toFixed(1)
            }}%
          </title>
        </circle>
      </g>
      <text
        x="90"
        y="82"
        text-anchor="middle"
        class="donut-share"
      >
        {{ Number(slices[0]!.percentage.toFixed(1)) }}
        <tspan class="donut-percent">%</tspan>
      </text>
      <text
        x="90"
        y="108"
        text-anchor="middle"
        class="donut-caption"
      >
        最大分类
      </text>
    </svg>
    <ul class="donut-legend">
      <li v-for="row in slices" :key="row.label">
        <i :style="{ background: row.color }" /><span>{{ row.label
        }}<small>{{ row.count }} 笔 · {{ row.percentage.toFixed(1) }}%</small></span><strong>{{ formatMoney(row.amount) }}</strong>
      </li>
    </ul>
  </div>
  <div v-else class="donut-empty">
    <svg viewBox="0 0 180 180" aria-hidden="true">
      <circle
        cx="90"
        cy="90"
        r="65"
        fill="none"
        stroke="#eff4f2"
        stroke-width="18"
      />
      <text
        x="90"
        y="98"
        text-anchor="middle"
        class="donut-caption"
      >
        暂无数据
      </text>
    </svg>
    <p>本期还没有{{ label }}记录。</p>
  </div>
</template>

<style scoped>
.category-visual {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}
.donut-svg {
  width: 180px;
  display: block;
}
.donut-share {
  fill: #294c53;
  font-family: var(--number-font);
  font-size: 26px;
}
.donut-percent {
  font-size: 13px;
}
.donut-caption {
  font-size: 11px;
  fill: #9aa9ac;
}
.donut-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 17px;
}
.donut-legend li {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 12px;
  min-width: 0;
}
.donut-legend i {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
}
.donut-legend span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  color: #546d77;
}
.donut-legend small {
  display: block;
  font-size: 10px;
  color: #98a9ab;
  margin-top: 5px;
}
.donut-legend strong {
  font-family: var(--number-font);
  font-size: 11px;
  font-weight: 500;
  color: #3d5862;
  overflow-wrap: anywhere;
  max-width: 45%;
  text-align: right;
}
.donut-empty {
  text-align: center;
  font-size: 11px;
  color: #94a6a3;
}
.donut-empty svg {
  width: 150px;
}
.donut-empty p {
  margin: 0;
}
@media (max-width: 1100px) {
  .category-visual {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .donut-svg {
    margin: auto;
    width: 168px;
  }
  .donut-legend {
    gap: 14px;
  }
}
@media (min-width: 761px) and (max-width: 1100px) {
  .category-visual {
    grid-template-columns: 168px minmax(0, 1fr);
  }
}
</style>
