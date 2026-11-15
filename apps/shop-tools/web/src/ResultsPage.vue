<script setup lang="ts">
import type {
  Config,
  Product,
  Result,
  Route,
} from '@t-box/shop-tools-contracts'
import { display } from '@t-box/shop-tools-core'
import { computed, ref } from 'vue'

const props = defineProps<{
  snapshot: {
    row: Product
    entries: { route: Route, result: Result | null, error: string }[]
    createdAt: string
  }
  config: Config
}>()
defineEmits<{ back: [] }>()
const selected = ref(props.snapshot.entries[0]?.route.site || '')
const groups = computed(() => [
  ...new Map(
    props.snapshot.entries.map((e) => [e.route.site, e.route.siteName]),
  ).entries(),
])
const entries = computed(() =>
  props.snapshot.entries
    .filter((e) => e.route.site === selected.value)
    .sort(
      (a, b) =>
        (b.result?.profit ?? -Infinity) - (a.result?.profit ?? -Infinity),
    ),
)
function money(value: number, route: Route) {
  return display(
    value,
    props.config.sites[route.site]?.precision ??
    Number(props.config.basic.precision),
  )
}
</script>

<template>
  <div class="toolbar">
    <div>
      <strong>{{
        [snapshot.row.sku, snapshot.row.name].filter(Boolean).join(' ')
          || '当前商品'
      }}
        · 方案比较</strong><small>各站点内按净利润从高到低排列 ·
        {{ new Date(snapshot.createdAt).toLocaleString() }}</small>
    </div>
    <button @click="$emit('back')">← 返回工作簿</button>
  </div>
  <div
    class="sheet-tabs"
    role="tablist"
    aria-label="结果站点"
  >
    <button
      v-for="[id, name] in groups"
      :key="id"
      role="tab"
      :aria-selected="selected === id"
      :class="{ selected: selected === id }"
      @click="selected = id"
    >
      {{ name }} ·
      {{ snapshot.entries.filter((e) => e.route.site === id).length }}
    </button>
  </div>
  <div class="result-grid">
    <article
      v-for="entry in entries"
      :key="entry.route.key"
      class="panel result-card"
    >
      <p class="delivery-tags">
        {{ entry.route.cargo }} / {{ entry.route.channel }} /
        {{ entry.route.region }}
      </p>
      <p class="muted">建议折前售价 · {{ entry.route.currency }}</p>
      <template v-if="entry.result"><div class="price-number">
                                      {{ money(entry.result.price, entry.route) }}
                                    </div>
        <p class="muted">
          ≈
          {{ money(entry.result.price / entry.route.exchange, entry.route) }}
          CNY · 折后 {{ money(entry.result.sale, entry.route) }}
          {{ entry.route.currency }}
        </p>
        <div class="profit-strip">
          <div>
            <small>预留汇损后净利润</small><strong :class="{ negative: entry.result.profit < 0 }">{{
                                                                                            money(entry.result.profit * entry.route.exchange, entry.route)
                                                                                          }}
              {{ entry.route.currency }}</strong><small>≈ {{ money(entry.result.profit, entry.route) }} CNY</small>
          </div>
          <div>
            <small>净利润率</small><strong>{{ money(entry.result.margin, entry.route) }}%</strong>
          </div>
        </div>
        <details>
          <summary>费用与计算明细</summary>
          <dl class="fee-list">
            <div
              v-for="[key, label] in [
                ['commission', '佣金'],
                ['trade', '交易手续费'],
                ['activity', '活动费'],
                ['hidden', '藏价（卖家运费）'],
                ['buyer', '买家运费'],
                ['withdraw', '提现手续费'],
                ['loss', '预留汇损'],
                ['revenue', '订单收入'],
              ] as const"
              :key="key"
            >
              <dt>{{ label }}</dt>
              <dd>
                {{ money(entry.result[key], entry.route) }}
                {{ entry.route.currency
                }}<small>≈
                  {{
                    money(entry.result[key] / entry.route.exchange, entry.route)
                  }}
                  CNY</small>
              </dd>
            </div>
          </dl>
          <p class="muted">
            市场汇率 {{ entry.route.exchange }} · 定价汇率
            {{ entry.result.pricingExchange }}<br>藏价：{{
              entry.result.sellerFormula
            }}<br>买家运费：{{ entry.result.buyerFormula }}
          </p>
        </details></template>
      <p v-else class="error-text">{{ entry.error }}</p>
    </article>
  </div>
</template>
