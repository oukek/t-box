<script setup lang="ts">
import type { Config, Quote } from '@t-box/shop-tools-contracts'

import { currencies } from '@t-box/shop-tools-contracts'
import { clone } from '@t-box/shop-tools-core'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { ref } from 'vue'
import EditDialog from './EditDialog.vue'

const props = defineProps<{ readonly?: boolean, quote: Quote | null, config: Config }>()
const emit = defineEmits<{ save: [value: Config], refresh: [] }>()
const amount = ref('100')
const inverse = ref(false)
const open = ref(false)
const loss = ref('4')
const error = ref('')
function edit() {
  loss.value = String(props.config.basic.loss)
  error.value = ''
  open.value = true
}
function save() {
  const value = Number(loss.value)
  if (
    !loss.value.trim() ||
    !Number.isFinite(value) ||
    value < 0 ||
    value >= 100
  ) {
    error.value = '预留汇损须在0至100之间（不含100）'
    return
  }
  const config = clone(props.config)
  config.basic.loss = value
  emit('save', config)
  open.value = false
}
function format(value: number | undefined) {
  return value === undefined || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value)
}
function convert(rate: number | undefined) {
  const n = Number(amount.value)
  if (!rate || !amount.value.trim() || !Number.isFinite(n) || n < 0) {
    return undefined
  }
  return inverse.value ? n / rate : n * rate
}
</script>

<template>
  <section class="panel exchange-panel">
    <div class="toolbar">
      <p>
        更新时间：{{
          quote ? new Date(quote.updatedAt).toLocaleString() : '尚未更新'
        }}
        · {{ quote?.source || 'Wise' }}
      </p>
      <button @click="emit('refresh')">刷新汇率</button>
    </div>
    <div class="toolbar risk-summary">
      <div>
        <strong>预留汇损 {{ config.basic.loss }}%</strong>
        <p class="muted">
          按结汇人民币收入减少此比例预留，仅影响后续定价，市场汇率保持原值。
        </p>
      </div>
      <button v-if="!readonly" @click="edit">设置汇损</button>
    </div>
    <div class="exchange-controls">
      <label class="field">{{ inverse ? '外币金额' : '人民币金额'
      }}<FormControl
        v-model="amount"
        type="number"
        min="0"
        step="any"
        placeholder="输入换算金额"
      /></label>
      <div
        class="segmented"
        role="group"
        aria-label="换算方向"
      >
        <button
          :class="{ selected: !inverse }"
          :aria-pressed="!inverse"
          @click="inverse = false"
        >
          人民币 → 外币</button><button
          :class="{ selected: inverse }"
          :aria-pressed="inverse"
          @click="inverse = true"
        >
          外币 → 人民币
        </button>
      </div>
    </div>
    <div class="rate-grid">
      <article
        v-for="[code, name] in currencies.slice(1)"
        :key="code"
        class="rate-card"
      >
        <div class="rate-card-top">
          <h2>{{ name }}</h2>
          <span>{{ code }}</span>
        </div>
        <p class="rate-unit">
          1 {{ inverse ? code : 'CNY' }} =
          {{
            format(
              quote?.rates[code]
                ? inverse
                  ? 1 / quote.rates[code]!
                  : quote.rates[code]
                : undefined,
            )
          }}
          {{ inverse ? 'CNY' : code }}
        </p>
        <p class="rate-unit">
          {{ inverse ? '保守结汇（1 外币）' : '定价汇率（1 CNY）' }}：{{
            format(
              quote?.rates[code]
                ? inverse
                  ? (1 - Number(config.basic.loss) / 100) / quote.rates[code]!
                  : quote.rates[code]! / (1 - Number(config.basic.loss) / 100)
                : undefined,
            )
          }}
          {{ inverse ? 'CNY' : code }}
        </p>
        <div class="converted-value">
          {{ format(convert(quote?.rates[code])) }}
          <small>{{ inverse ? 'CNY' : code }}</small>
        </div>
      </article>
    </div>
  </section>
  <EditDialog
    :open="open"
    title="设置预留汇损"
    @close="open = false"
    @save="save"
  ><p
     v-if="error"
     class="error-text"
     role="alert"
   >{{ error }}</p>
    <label class="field">预留汇损（%）<FormControl
      v-model="loss"
      type="number"
      min="0"
      max="99.9999"
      step="any"
    /></label>
    <p class="muted">
      默认4%。例如按市场汇率可结汇100元，定价时保守按96元计算。填0表示不预留。保存后对所有站点及三种模式生效，已有计算记录保持原值。
    </p></EditDialog>
</template>
