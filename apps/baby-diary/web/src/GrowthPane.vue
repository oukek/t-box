<script setup lang="ts">
import type { GrowthRecord } from '@t-box/baby-diary-contracts'
import { measurementSeries } from '@t-box/baby-diary-core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BabyDoodle from './BabyDoodle.vue'
import { base, errorText, invoke, onPrivateClear } from './runtime'

const props = defineProps<{ revision: number }>()
const records = ref<GrowthRecord[]>([])
const metric = ref<'heightMm' | 'weightGrams' | 'headMm'>('heightMm')
const error = ref('')
const loading = ref(false)
const truncated = ref(false)
let version = 0
const metrics = [
  { id: 'heightMm', title: '身长 / 身高', unit: 'cm', divisor: 10 },
  { id: 'weightGrams', title: '体重', unit: 'kg', divisor: 1000 },
  { id: 'headMm', title: '头围', unit: 'cm', divisor: 10 },
] as const
const current = computed(() => metrics.find((row) => row.id === metric.value)!)
const series = computed(() =>
  measurementSeries(records.value, metric.value).map((row) => ({
    ...row,
    value: row.value / current.value.divisor,
  })),
)
const latest = computed(() => series.value.at(-1))
const previous = computed(() => series.value.at(-2))
const delta = computed(() =>
  latest.value && previous.value
    ? Number((latest.value.value - previous.value.value).toFixed(3))
    : null,
)
const points = computed(() => {
  const values = series.value
  const min = Math.min(...values.map((row) => row.value))
  const max = Math.max(...values.map((row) => row.value))
  const start = Date.parse(values[0]?.date || '')
  const end = Date.parse(values.at(-1)?.date || '')
  return values.map((row) => ({
    ...row,
    x:
      values.length < 2 || end === start
        ? 300
        : 38 + ((Date.parse(row.date) - start) / (end - start)) * 524,
    y: max === min ? 120 : 194 - ((row.value - min) / (max - min)) * 144,
  }))
})
const path = computed(() =>
  points.value.map((row) => `${row.x},${row.y}`).join(' '),
)
async function load() {
  const currentVersion = ++version
  loading.value = true
  error.value = ''
  try {
    const result = await invoke<{
      records: GrowthRecord[]
      truncated: boolean
    }>('growth_get', { ...base(), limit: 5000 })
    if (version === currentVersion) {
      records.value = result.records
      truncated.value = result.truncated
    }
  } catch (e) {
    if (version === currentVersion) {
      records.value = []
      error.value = errorText(e)
    }
  } finally {
    if (version === currentVersion) {
      loading.value = false
    }
  }
}
watch(
  () => props.revision,
  () => {
    void load()
  },
)
onMounted(() => {
  void load()
})
const stop = onPrivateClear(() => {
  version++
  records.value = []
})
onBeforeUnmount(() => {
  version++
  stop()
})
</script>

<template>
  <section aria-label="成长趋势">
    <div class="section-heading">
      <h2>一点点长大</h2>
      <span class="subtle">{{ records.length }} 次测量</span>
    </div>
    <div class="metric-tabs">
      <button
        v-for="item in metrics"
        :key="item.id"
        :class="{ selected: metric === item.id }"
        @click="metric = item.id"
      >
        {{ item.title }}
      </button>
    </div>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
    <div v-if="latest" class="growth-paper">
      <div class="growth-current">
        <div>
          <small>最近一次 · {{ latest.date }}</small>
          <p>
            <b>{{ latest.value }}</b><span>{{ current.unit }}</span>
          </p>
        </div>
        <div v-if="delta !== null" class="growth-delta">
          <span>较上次</span><strong>{{ delta > 0 ? "+" : "" }}{{ delta }} {{ current.unit }}</strong>
        </div>
      </div>
      <svg
        class="growth-chart"
        viewBox="0 0 600 245"
        role="img"
        :aria-label="`${current.title}变化曲线，${series.length}个测量点`"
      >
        <defs>
          <linearGradient
            id="baby-growth-fill"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0"
              stop-color="var(--baby-accent)"
              stop-opacity=".15"
            />
            <stop
              offset="1"
              stop-color="var(--baby-accent)"
              stop-opacity="0"
            />
          </linearGradient>
        </defs>
        <path
          v-for="y in [50, 98, 146, 194]"
          :key="y"
          :d="`M38 ${y}H562`"
          stroke="var(--baby-line)"
          stroke-dasharray="3 6"
        />
        <polygon
          v-if="points.length > 1"
          :points="`${points[0].x},210 ${path} ${points.at(-1)!.x},210`"
          fill="url(#baby-growth-fill)"
        />
        <polyline
          :points="path"
          fill="none"
          stroke="var(--baby-accent)"
          stroke-width="2.5"
          stroke-linejoin="round"
        />
        <circle
          v-for="point in points"
          :key="point.id"
          :cx="point.x"
          :cy="point.y"
          r="4"
          fill="var(--baby-paper)"
          stroke="var(--baby-accent)"
          stroke-width="2"
        >
          <title>{{ point.date }} · {{ point.value }} {{ current.unit }}</title>
        </circle>
        <text x="38" y="235">{{ series[0].date }}</text>
        <text
          x="562"
          y="235"
          text-anchor="end"
        >{{ latest.date }}</text>
      </svg>
      <p class="subtle">
        只连接实际测量点，不填补缺失数据。躺量身长与站量身高的测量方式可能不同。
      </p>
    </div>
    <div v-else class="empty-state">
      <BabyDoodle scene="growth" />
      <h3>{{ loading ? "正在读取测量记录…" : "还没有这项测量" }}</h3>
      <p>在「记录」中记一次身高、体重或头围，看看真实的成长变化。</p>
    </div>
    <p v-if="truncated" class="subtle">
      当前最多展示最近 5000 次测量，更多数据请在记录页按日期查阅。
    </p>
    <div v-if="series.length" class="growth-history">
      <h3>测量明细</h3>
      <div
        v-for="row in [...series].reverse()"
        :key="row.id"
        class="list-row"
      >
        <time>{{ row.date }}</time><small>{{
          { standing: "站量", lying: "躺量", unspecified: "未注明方式" }[
            row.method
          ]
        }}</small><strong>{{ row.value }} {{ current.unit }}</strong>
      </div>
    </div>
    <p class="footnote">成长记录用于日常回顾，不构成健康评估或医疗建议。</p>
  </section>
</template>
