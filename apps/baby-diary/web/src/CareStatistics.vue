<script setup lang="ts">
import type { CareDay } from '@t-box/baby-diary-contracts/care'
import { careDuration } from '@t-box/baby-diary-core'
import { computed, ref } from 'vue'

const props = defineProps<{ days: CareDay[], complete: boolean, pending: number }>()
const metric = ref<'bottleMl' | 'sleepMs' | 'changes'>('bottleMl')
const totals = computed(() => props.days.reduce((sum, day) => ({ bottleMl: sum.bottleMl + day.bottleMl, feedings: sum.feedings + day.feedings, nursingMs: sum.nursingMs + day.nursingMs, sleepMs: sum.sleepMs + day.sleepMs, changes: sum.changes + day.changes, wet: sum.wet + day.wet, dirty: sum.dirty + day.dirty, unknownBottles: sum.unknownBottles + day.unknownBottles }), { bottleMl: 0, feedings: 0, nursingMs: 0, sleepMs: 0, changes: 0, wet: 0, dirty: 0, unknownBottles: 0 }))
const maximum = computed(() => Math.max(...props.days.map((day) => day[metric.value]), 1))
const value = (day: CareDay) => metric.value === 'sleepMs' ? careDuration(day.sleepMs) : `${day[metric.value]}${metric.value === 'bottleMl' ? ' mL' : ' 次'}`
</script>

<template>
  <div class="care-statistics">
    <div class="care-summary-grid">
      <article class="baby-card"><small>已记录瓶喂</small><strong>{{ complete ? totals.bottleMl : '—' }}<span>mL</span></strong><p>喂养 {{ totals.feedings }} 次 · 亲喂 {{ careDuration(totals.nursingMs) }}</p></article>
      <article class="baby-card"><small>已记录睡眠</small><strong class="care-duration-value">{{ complete ? careDuration(totals.sleepMs) : '尚无完整缓存' }}</strong><p>按宝宝时区分摊跨日时长</p></article>
      <article class="baby-card"><small>更换尿布</small><strong>{{ complete ? totals.changes : '—' }}<span>次</span></strong><p>尿尿 {{ totals.wet }} 次 · 便便 {{ totals.dirty }} 次</p></article>
    </div>
    <div class="care-segments care-chart-tabs">
      <button
        v-for="item in ([{ id: 'bottleMl', label: '瓶喂量' }, { id: 'sleepMs', label: '睡眠' }, { id: 'changes', label: '尿布' }] as const)"
        :key="item.id"
        :class="{ selected: metric === item.id }"
        @click="metric = item.id"
      >{{ item.label }}</button>
    </div>
    <div
      v-if="complete"
      class="care-bar-chart"
      role="img"
      :aria-label="`${days.length} 天${{ bottleMl: '瓶喂量', sleepMs: '睡眠', changes: '尿布' }[metric]}趋势`"
    >
      <div
        v-for="day in days"
        :key="day.date"
        class="care-chart-day"
        :title="`${day.date} ${value(day)}`"
      >
        <span class="care-chart-value">{{ metric === 'sleepMs' ? (day.sleepMs / 3600000).toFixed(1) : day[metric] }}</span>
        <div class="care-bar-track"><i :style="{ height: `${day[metric] / maximum * 100}%` }" /></div>
        <small>{{ day.date.slice(8) }}</small>
      </div>
    </div>
    <p v-else class="care-empty">该时间范围没有完整的本机缓存，联网后可查看统计。</p>
    <p class="subtle care-chart-caption">{{ metric === 'sleepMs' ? '图中单位：小时。重叠睡眠时段只计算一次。' : metric === 'bottleMl' ? '仅汇总实际填写的瓶喂量，不包含无法测量奶量的亲喂。' : '一次尿尿＋便便计为更换一次，排尿和排便各一次。' }}{{ pending ? ' 含待同步草稿，尚未得到云端确认。' : '' }}</p>
    <p v-if="totals.unknownBottles" class="subtle">另有 {{ totals.unknownBottles }} 段瓶喂未填写奶量，没有按 0 mL 计入。</p>
    <div class="care-day-table">
      <div class="care-day-table-head"><span>日期</span><span>瓶喂</span><span>睡眠</span><span>尿布</span></div>
      <div v-for="day in [...days].reverse()" :key="day.date"><time>{{ day.date.slice(5) }}</time><span>{{ complete ? `${day.bottleMl} mL` : '—' }}</span><span>{{ complete ? careDuration(day.sleepMs) : '—' }}</span><span>{{ complete ? `${day.changes} 次` : '—' }}</span></div>
    </div>
    <p class="footnote">这里只反映已记录的情况。空白不代表没有发生；今天尚未结束，不与完整的一天直接比较。</p>
  </div>
</template>
