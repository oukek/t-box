<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { ConversionResult } from '@t-box/converter-contracts'
import type { ConversionPair, ConverterPreferences } from './preferences'
import { conversionCatalog, convertUnits } from '@t-box/converter-core'
import { AppIcon, SidePanel } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { pairKey, readPreferences } from './preferences'
import SelectionSheet from './SelectionSheet.vue'

const props = defineProps<{ client: AppClient, params: Record<string, string>, revision: number }>()
const catalog = conversionCatalog
const preferences = reactive<ConverterPreferences>(readPreferences(null))
const preferencesReady = ref(false)
const form = reactive({ category: 'length', from: 'm', to: 'cm', value: '1' })
const notice = ref('')
const shortcutAvailable = ref(false)
void Promise.all([props.client.runtime.supports('automation.saveShortcut'), props.client.auth.getSession()]).then(([supported, session]) => {
  shortcutAvailable.value = supported && session.status === 'signed_in'
}).catch(() => {})
async function saveShortcut() {
  try {
    await props.client.automation.saveShortcut({ title: `${form.value} ${form.from} → ${form.to}`.slice(0, 100), actionId: 'convert', actionVersion: 1, arguments: { category: form.category, value: form.value, from: form.from, to: [form.to] } })
    notice.value = '已保存，可在系统快捷指令中选择“执行 T方舟 快捷动作”。'
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : '保存失败'
  }
}
const query = ref('')
const historyOpen = ref(false)
let inputRevision = 0
let disposed = false
let storageWrites = Promise.resolve()
const current = computed(() => catalog.find((item) => item.id === form.category))
const categories = computed(() => catalog.filter((item) => [item.name, item.description, ...item.units.flatMap((unit) => [unit.name, unit.symbol, ...unit.aliases])].join(' ').toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const groups = computed(() => [...new Set(categories.value.map((item) => item.group))])
const calculation = computed<{ result: ConversionResult | null, error: string }>(() => {
  const category = current.value
  if (!category || !form.value.trim()) {
    return { result: null, error: '' }
  }
  try {
    return {
      result: convertUnits({ category: category.id, from: form.from, value: form.value.trim(), to: category.units.map((unit) => unit.id) }),
      error: '',
    }
  } catch (cause) {
    return { result: null, error: cause instanceof Error ? cause.message : '换算失败，请检查输入' }
  }
})
const converted = computed(() => calculation.value.result)
const error = computed(() => calculation.value.error)
const primary = computed(() => converted.value?.results.find((item) => item.unit.id === form.to))
const equivalents = computed(() => converted.value?.results.filter((item) => item.unit.id !== form.from && item.unit.id !== form.to) || [])
const isFavorite = computed(() => preferences.favorites.some((pair) => pairKey(pair) === pairKey(form)))
const unitCount = computed(() => catalog.reduce((total, item) => total + item.units.length, 0))
const categoryOptions = computed(() => catalog.map((item) => ({ ...item, description: item.description, keywords: item.units.flatMap((unit) => [unit.name, unit.symbol]) })))
const storageKey = 'converter.preferences.v1'

function apply(pair: ConversionPair, value = form.value) {
  const category = catalog.find((entry) => entry.id === pair.category)
  if (!category) {
    return
  }
  form.category = category.id
  form.from = category.units.some((unit) => unit.id === pair.from) ? pair.from : category.defaults[0]
  form.to = category.units.some((unit) => unit.id === pair.to) ? pair.to : category.defaults[1]
  form.value = value
  historyOpen.value = false
}
function chooseCategory(id: string) {
  const category = catalog.find((entry) => entry.id === id)
  if (category) {
    apply({ category: id, from: category.defaults[0], to: category.defaults[1] }, '1')
  }
}
function navigation() {
  const saved = preferences.last
  const categoryId = props.params.category || saved?.category || 'length'
  const category = catalog.find((item) => item.id === categoryId) || catalog[0]
  if (!category) {
    return
  }
  const useSaved = !Object.keys(props.params).length
  apply({ category: category.id, from: props.params.from || (useSaved ? saved?.from : '') || category.defaults[0], to: props.params.to || (useSaved ? saved?.to : '') || category.defaults[1] }, props.params.value || (useSaved ? saved?.value : '') || '1')
}
async function loadPreferences() {
  const observedRevision = inputRevision
  try {
    const saved = await props.client.storage.get(storageKey)
    // SDK preference restoration must never block conversion or overwrite a fresh edit.
    if (disposed) {
      return
    }
    Object.assign(preferences, readPreferences(saved))
    if (observedRevision === inputRevision) {
      navigation()
    }
    preferencesReady.value = true
  } catch {
    if (!disposed) {
      notice.value = '账号收藏和记录暂不可用，换算不受影响'
    }
  }
}
function persist() {
  preferences.last = { category: form.category, from: form.from, to: form.to, value: form.value }
  const snapshot = { favorites: preferences.favorites.map((pair) => ({ ...pair })), history: preferences.history.map((entry) => ({ ...entry })), last: { ...preferences.last } }
  // Preserve click order when consecutive SDK writes receive asynchronous bridge acknowledgements.
  storageWrites = storageWrites.then(() => props.client.storage.set(storageKey, snapshot)).catch(() => {
    notice.value = '偏好暂未保存，本次仍可继续换算'
  })
  return storageWrites
}
function favorite() {
  if (!preferencesReady.value) {
    return
  }
  const pair = { category: form.category, from: form.from, to: form.to }
  if (isFavorite.value) {
    preferences.favorites = preferences.favorites.filter((entry) => pairKey(entry) !== pairKey(pair))
  } else if (preferences.favorites.length < 12) {
    preferences.favorites.unshift(pair)
  } else {
    notice.value = '最多收藏 12 组换算，请先取消一组'
    return
  }
  void persist()
}
function remember() {
  if (!preferencesReady.value || !converted.value || !primary.value) {
    return
  }
  preferences.history.unshift({ id: crypto.randomUUID(), category: form.category, from: form.from, to: form.to, value: converted.value.value, time: new Date().toISOString() })
  preferences.history = preferences.history.slice(0, 30)
  notice.value = '已保存到换算记录'
  void persist()
}
function label(pair: ConversionPair) {
  const category = catalog.find((item) => item.id === pair.category)
  const symbol = (id: string) => category?.units.find((unit) => unit.id === id)?.symbol || id
  return `${symbol(pair.from)} → ${symbol(pair.to)}`
}
async function copy(value: string, symbol: string) {
  try {
    await navigator.clipboard.writeText(`${value} ${symbol}`)
    notice.value = '已复制结果'
  } catch {
    notice.value = '复制失败，请长按选择结果复制'
  }
}
function swap() {
  const original = form.from
  const amount = primary.value?.value
  form.from = form.to
  form.to = original
  if (amount) {
    form.value = amount
  }
}
navigation()
watch(() => [form.category, form.from, form.to, form.value], () => {
  inputRevision++
}, { flush: 'sync' })
watch(() => props.revision, navigation)
onMounted(loadPreferences)
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div class="converter-page">
    <div class="converter-toolbar"><span>{{ catalog.length || '—' }} 类 · {{ unitCount || '—' }} 个单位</span><button
      v-if="preferences.history.length"
      class="subtle-button"
      type="button"
      @click="historyOpen = true"
    ><AppIcon name="history" :size="17" />记录</button></div>
    <div class="converter-layout">
      <aside class="converter-sidebar" aria-label="换算类别">
        <div class="category-search"><AppIcon name="search" :size="16" /><input
          v-model="query"
          type="search"
          aria-label="搜索换算类别或单位"
          placeholder="搜索类别或单位"
        ></div>
        <section v-for="group in groups" :key="group"><h2>{{ group }}</h2><button
          v-for="item in categories.filter((item) => item.group === group)"
          :key="item.id"
          :aria-current="item.id === form.category ? 'page' : undefined"
          @click="chooseCategory(item.id)"
        ><span>{{ item.name }}</span><small>{{ item.units.length }}</small></button></section>
        <p v-if="!categories.length" class="unit-empty">没有匹配的类别</p>
      </aside>
      <section class="converter-workbench" :aria-label="current?.name">
        <div class="converter-mobile-category"><SelectionSheet
          :model-value="form.category"
          :options="categoryOptions"
          title="换算类别"
          @update:model-value="chooseCategory"
        /></div>
        <div
          v-if="preferences.favorites.length"
          class="conversion-favorites"
          aria-label="常用换算"
        ><button
          v-for="pair in preferences.favorites"
          :key="pairKey(pair)"
          @click="apply(pair)"
        >{{ label(pair) }}</button></div>
        <header class="converter-heading"><div><h2>{{ current?.name }}</h2><p>{{ current?.description }}</p></div><button
          class="favorite-button"
          :aria-label="isFavorite ? '取消收藏这组换算' : '收藏这组换算'"
          :aria-pressed="isFavorite"
          :disabled="!preferencesReady"
          :title="preferencesReady ? undefined : '账号收藏和记录尚未就绪，换算可正常使用'"
          @click="favorite"
        >{{ isFavorite ? '★' : '☆' }}</button></header>
        <div class="conversion-card">
          <div class="conversion-half"><span class="field-caption">原始数值</span><div class="conversion-value-line"><label class="amount-input"><span class="sr-only">待换算数值</span><input
            v-model="form.value"
            type="text"
            inputmode="decimal"
            maxlength="120"
            autocomplete="off"
            spellcheck="false"
            placeholder="输入数值"
            aria-label="待换算数值"
          ></label><div class="unit-column"><SelectionSheet
            v-model="form.from"
            :options="current?.units || []"
            title="原单位"
          /></div></div></div>
          <div class="conversion-axis"><span /><button
            type="button"
            aria-label="交换原单位与目标单位"
            title="交换单位"
            @click="swap"
          ><AppIcon name="exchange" :size="20" /></button><span /></div>
          <div class="conversion-half conversion-target"><span class="field-caption">换算结果 </span><div class="conversion-value-line"><output
            class="converted-amount"
            aria-live="polite"
            aria-label="换算结果"
          ><small v-if="primary?.approximate">≈</small>{{ primary?.value || '—' }}</output><div class="unit-column"><SelectionSheet
            v-model="form.to"
            :options="current?.units || []"
            title="目标单位"
          /></div></div></div>
          <footer class="conversion-actions"><span>{{ converted ? `保留至多 ${converted.significantDigits} 位有效数字` : '支持科学计数法，如 1.25e3' }}</span><button
            type="button"
            class="subtle-button"
            :disabled="!primary"
            aria-label="复制换算结果"
            @click="primary && copy(primary.value, primary.unit.symbol)"
          ><AppIcon name="copy" :size="16" /></button><button
            type="button"
            class="subtle-button"
            :disabled="!primary || !preferencesReady"
            @click="remember"
          >保存记录</button><button
            v-if="shortcutAvailable"
            type="button"
            class="subtle-button"
            :disabled="!primary"
            @click="saveShortcut"
          >保存为快捷动作</button></footer>
        </div>
        <p
          v-if="error"
          class="converter-error"
          role="alert"
        >{{ error }}</p><p
          v-if="notice"
          class="converter-notice"
          role="status"
        >{{ notice }}<button aria-label="关闭提示" @click="notice = ''"><AppIcon name="close" :size="14" /></button></p>
        <section v-if="equivalents.length" class="conversion-equivalents"><h3>也等于</h3><div class="equivalent-grid"><button
          v-for="item in equivalents"
          :key="item.unit.id"
          :title="`选择目标单位：${item.unit.name}`"
          @click="form.to = item.unit.id"
        ><span>{{ item.unit.name }}<small>{{ item.unit.symbol }}</small></span><strong>{{ item.approximate ? '≈ ' : '' }}{{ item.value }}</strong></button></div></section>
        <details class="conversion-notes"><summary><AppIcon name="info" :size="15" />单位说明</summary><p>{{ current?.note }}</p><p>“≈”表示使用近似系数或结果经过有效数字舍入。</p></details>
      </section>
    </div>
    <SidePanel
      :open="historyOpen"
      title="换算记录"
      @close="historyOpen = false"
    ><div class="conversion-history"><button
      v-for="record in preferences.history"
      :key="record.id"
      @click="apply(record, record.value)"
    ><span>{{ label(record) }}</span><strong>{{ record.value }}</strong><small>{{ new Date(record.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</small></button></div></SidePanel>
  </div>
</template>
