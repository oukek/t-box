<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { CatalogSku, PricingSnapshot, Product, Quote, Route, Sheet, SitePayload, WorkspaceHeader } from '@t-box/shop-tools-contracts'
import { modes, projectSites } from '@t-box/shop-tools-contracts'
import { calculate, clone, defaultConfig, newRow, routesFrom } from '@t-box/shop-tools-core'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{ client: AppClient, projectId: string, site: string, sku: CatalogSku }>()
const emit = defineEmits<{ close: [], confirm: [snapshot: PricingSnapshot] }>()
const sheets = ref<Omit<Sheet, 'rows'>[]>([])
const selected = ref('')
const row = ref<Product>(newRow())
const settings = ref<Sheet['settings']>({ date: '', mode: 'profit', routeKey: '' })
const route = ref<Route>()
const busy = ref(false)
const error = ref('')
const restored = ref(false)
let config = defaultConfig()
let sequence = 0
const result = computed(() => {
  try {
    return route.value ? calculate(row.value, settings.value, route.value) : null
  } catch {
    return null
  }
})
const numeric = [['cost', '成本（CNY）'], ['weight', '重量（kg）'], ['domestic', '国内运费（CNY）'], ['target', '目标值'], ['discount', '折扣（%）'], ['activity', '活动费（%）'], ['withdraw', '提现费（%）'], ['loss', '预留汇损（%）']] as const
async function useSheet(id: string) {
  selected.value = id
  const sheet = sheets.value.find((s) => s.id === id)
  if (!sheet) {
    return
  }
  const token = ++sequence
  busy.value = true
  error.value = ''
  route.value = undefined
  try {
    const [quote, payload] = await Promise.all([props.client.api.invoke<Quote>('rates', {}), props.client.api.invoke<SitePayload>('sites', { date: sheet.settings.date })])
    if (token !== sequence) {
      return
    }
    const picked = routesFrom(payload.sites, payload.shipping.site_info, quote.rates, config).find((r) => r.key === sheet.settings.routeKey)
    if (!picked) {
      throw new Error('此 Sheet 尚未配置有效物流方案，请先在项目计价表中配置')
    }
    if (picked.currency !== projectSites.find((s) => s.value === props.site)?.currency) {
      throw new Error('此 Sheet 币种不符合项目站点，请选择同币种方案')
    }
    route.value = clone(picked)
    settings.value = clone(sheet.settings)
    row.value = { ...newRow(config.basic), id: props.sku.id, sku: props.sku.code, name: props.sku.name, cost: props.sku.cost ?? '', target: row.value.target }
    restored.value = false
  } catch (e) {
    error.value = String(e)
  } finally {
    if (token === sequence) {
      busy.value = false
    }
  }
}
onMounted(async () => {
  busy.value = true
  try {
    const header = await props.client.api.invoke<WorkspaceHeader>('workspace_get', { projectId: props.projectId })
    sheets.value = header.metadata?.sheets || []
    config = header.config || defaultConfig()
    const previous = props.sku.pricing
    if (previous) {
      selected.value = previous.sheetId
      row.value = { ...clone(previous.row), id: props.sku.id, sku: props.sku.code, name: props.sku.name }
      row.value.cost = props.sku.cost ?? ''
      route.value = clone(previous.route)
      settings.value = clone(previous.settings)
      restored.value = true
    } else if (sheets.value.length) {
      await useSheet(sheets.value[0]!.id)
    } else {
      error.value = '请先在项目计价表中建立 Sheet 并设置物流方案'
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
})
function confirm() {
  if (!result.value || !route.value || busy.value) {
    return
  }
  emit('confirm', { sheetId: selected.value, sheetName: sheets.value.find((s) => s.id === selected.value)?.name || props.sku.pricing?.sheetName || '历史方案', row: clone(row.value), settings: clone(settings.value), route: clone(route.value), result: clone(result.value), time: new Date().toISOString() })
}
</script>

<template>
  <Modal
    open
    :title="sku.name + ' · SKU 算价'"
    :busy="busy"
    class="shop-dialog shop-dialog-long catalog-pricing"
    @close="emit('close')"
  >
    <div class="shop-dialog-body">
      <p v-if="error" role="alert">{{ error }}</p><p v-if="restored">已恢复上次计价参数。选择 Sheet 或点击“使用最新方案”可重新加载参数。</p>
      <SheetSelect
        :model-value="selected"
        label="当前项目的计价 Sheet"
        desktop-modal
        :options="sheets.map(s => ({ value: s.id, label: s.name }))"
        :disabled="busy"
        @update:model-value="useSheet(String($event))"
      />
      <button :disabled="busy || !sheets.some(s => s.id === selected)" @click="useSheet(selected)">使用最新方案</button>
      <SheetSelect
        v-model="settings.mode"
        label="计算方式"
        desktop-modal
        :options="modes"
      />
      <p v-if="route">{{ route.label }} · {{ route.currency }}</p>
      <div class="fields two-columns"><label
        v-for="[key, label] in numeric"
        :key="key"
        class="field"
      >{{ label }}<FormControl
        v-model="row[key]"
        type="number"
        min="0"
        step="0.01"
      /></label></div>
      <label v-if="route" class="field">汇率：1 CNY 对应 {{ route.currency }}<FormControl
        v-model.number="route.exchange"
        type="number"
        min="0"
        step="0.0001"
      /></label>
      <p v-if="!result && !busy">请补齐成本、重量、目标值及有效费率。</p>
      <div v-if="result && route" class="notice"><strong>折前售价 {{ result.price }} {{ route.currency }}</strong><p>折后 {{ result.sale }} · 预计利润 {{ result.profit.toFixed(2) }} CNY</p></div>
      <p>只回填当前商品 SKU，确认后请保存商品；不会向项目计价表写入行。</p>
    </div>
    <template #footer><strong v-if="result && route" class="catalog-price-result">折前 {{ result.price }} {{ route.currency }}</strong><button :disabled="busy" @click="emit('close')">取消</button><button
      class="primary"
      :disabled="busy || !result"
      @click="confirm"
    >确认并回填</button></template>
  </Modal>
</template>
