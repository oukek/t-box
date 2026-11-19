<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type {
  Book,
  Config,
  Product,
  Quote,
  Result,
  Route,
  Settings,
  Sheet,
  SitePayload,
  WorkspaceState,
} from '@t-box/shop-tools-contracts'
import { inputs, modes, outputs, ShopError } from '@t-box/shop-tools-contracts'
import {
  calculate,
  clone,
  defaultConfig,
  display,
  hasProduct,
  localDate,
  newRow,
  newSheet,
  paste,
  routesFrom,
} from '@t-box/shop-tools-core'
import { BottomSheet, Modal, SheetSelect } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ConfigPage from './ConfigPage.vue'
import EditDialog from './EditDialog.vue'
import { download, exportBook, importBook } from './excel'
import ExchangePage from './ExchangePage.vue'
import { lockPageZoom } from './pageViewport'
import ResultsPage from './ResultsPage.vue'
import RoutePicker from './RoutePicker.vue'
import TableViewport from './TableViewport.vue'
import { createWorkspaceStore } from './workspace'

const props = defineProps<{ client: AppClient }>()
const workspaceStore = createWorkspaceStore(props.client)
const actionsOpen = ref(false)
const searchOpen = ref(false)
const tableScale = ref(1)
let unlockZoom: (() => void) | undefined
function zoomTable(delta: number) {
  tableScale.value =
    Math.round(Math.max(0.6, Math.min(1.8, tableScale.value + delta)) * 100) /
    100
}
function action(fn: () => unknown) {
  actionsOpen.value = false
  void fn()
}
const reloadOpen = ref(false)
const leaveOpen = ref(false)
const leaving = ref(false)
let editSequence = 0
let dirty = false
const page = ref('home')
const config = ref<Config>(defaultConfig())
const quote = ref<Quote | null>(null)
const first = newSheet('商品定价 1')
const book = ref<Book>({ version: 1, activeSheetId: first.id, sheets: [first] })
const data = ref<Record<string, SitePayload>>({})
const error = ref('')
const saveState = ref('')
const ready = ref(false)
const busy = ref(false)
const recovery = ref(false)
const compactSaveStatus = computed(() => {
  if (!ready.value) {
    return saveState.value.includes('无法') ? '连接失败' : '连接中…'
  }
  if (recovery.value) {
    return saveState.value === '云端版本冲突' ? '保存冲突' : '需重新加载'
  }
  if (saveState.value === '尚未保存到云端') {
    return '未保存'
  }
  if (
    saveState.value.includes('正在保存') ||
    saveState.value.includes('等待')
  ) {
    return '保存中…'
  }
  return saveState.value === '已保存到云端' ? '已保存' : '自动保存已开启'
})
const saveInFlight = computed(() => saveState.value === '正在保存到云端…')
const active = computed(
  () =>
    book.value.sheets.find((s) => s.id === book.value.activeSheetId) ||
    book.value.sheets[0]!,
)
function routes(date: string, all = false) {
  const p = data.value[date]
  return p && quote.value
    ? routesFrom(
        p.sites,
        p.shipping.site_info,
        quote.value.rates,
        all ? { ...config.value, sites: {} } : config.value,
      )
    : []
}
function routeFor(s: Sheet) {
  return routes(s.settings.date).find((r) => r.key === s.settings.routeKey)
}
const route = computed(() => routeFor(active.value))
const precision = computed(
  () =>
    config.value.sites[route.value?.site || '']?.precision ??
    Number(config.value.basic.precision),
)
const comparison = ref<{
  row: Product
  settings: Settings
  entries: { route: Route, result: Result | null, error: string }[]
  createdAt: string
} | null>(null)
const moreFees = ref(false)
const search = ref('')
const detail = ref<{
  row: Product
  result: Result
  route: Route
  time: string
} | null>(null)
const shown = computed(() =>
  active.value.rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        !search.value ||
        `${row.sku} ${row.name}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    ),
)
const cols = computed(() => (moreFees.value ? inputs : inputs.slice(0, 6)))
function result(row: Product) {
  if (!hasProduct(row)) {
    return { values: null, error: '' }
  }
  try {
    if (!route.value) {
      throw ShopError.invalid('请选择有效物流方案')
    }
    return {
      values: calculate(row, active.value.settings, route.value),
      error: '',
    }
  } catch (e) {
    return { values: null, error: message(e) }
  }
}
const calculated = computed(
  () => new Map(active.value.rows.map((row) => [row.id, result(row)])),
)
const summary = computed(() => {
  const r = [...calculated.value.values()]
  return {
    ok: r.filter((i) => i.values).length,
    errors: r.filter((i) => i.error).length,
  }
})
function message(e: unknown) {
  return e instanceof Error ? e.message : '操作失败，请重试'
}
async function run(fn: () => Promise<unknown> | unknown) {
  error.value = ''
  try {
    return await fn()
  } catch (e) {
    error.value = message(e)
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
let saving = Promise.resolve()
function scheduleSave() {
  if (!ready.value || recovery.value) {
    return
  }
  editSequence++
  dirty = true
  saveState.value = '等待保存到云端…'
  clearTimeout(timer)
  timer = setTimeout(() => void persist(), 800)
}
let saveSequence = 0
async function persist() {
  clearTimeout(timer)
  if (!ready.value || recovery.value) {
    return false
  }
  const snapshot: WorkspaceState = clone({
    book: book.value,
    config: config.value,
    detail: detail.value,
    comparison: comparison.value,
  })
  const sequence = ++saveSequence
  const editingAtStart = editSequence
  saveState.value = '正在保存到云端…'
  const request = saving
    .catch(() => {})
    .then(() => workspaceStore.save(snapshot))
  saving = request
  try {
    await request
    if (sequence === saveSequence && editingAtStart === editSequence) {
      dirty = false
      saveState.value = '已保存到云端'
    }
    return true
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'SHOP_CONFLICT' || code === 'SHOP_INSTALLATION_CHANGED') {
      recovery.value = true
      clearTimeout(timer)
    }
    saveState.value =
      code === 'SHOP_CONFLICT' ? '云端版本冲突' : '尚未保存到云端'
    error.value = message(e) + '；当前修改仍在页面中，可导出工作簿备份'
    return false
  }
}
watch([book, config, detail, comparison], scheduleSave, { deep: true })
async function refreshRates() {
  await run(async () => {
    const next = await props.client.api.invoke<Quote>('rates', {})
    quote.value = next
  })
}
async function loadDate(date: string, force = false) {
  if (data.value[date] && !force) {
    return
  }
  await run(async () => {
    const next = await props.client.api.invoke<SitePayload>('sites', { date })
    data.value[date] = next
  })
}
watch(page, (value) => {
  if (value === 'config') {
    void loadDate(localDate())
  }
})
watch(
  () => active.value.settings.date,
  (date) => {
    if (ready.value) {
      void loadDate(date)
    }
  },
)
const settingsOpen = ref(false)
const draft = ref<{ name: string, settings: Settings }>({
  name: '',
  settings: clone(first.settings),
})
const draftRoutes = computed(() => routes(draft.value.settings.date))
function editSheet() {
  draft.value = {
    name: active.value.name,
    settings: clone(active.value.settings),
  }
  settingsOpen.value = true
}
watch(
  () => draft.value.settings.date,
  (date) => {
    if (settingsOpen.value) {
      void loadDate(date)
    }
  },
)
function saveSheet() {
  void run(() => {
    if (!draft.value.name.trim() || draft.value.name.length > 100) {
      throw ShopError.invalid('工作表名称须为1–100个字符')
    }
    if (
      !draftRoutes.value.some((r) => r.key === draft.value.settings.routeKey)
    ) {
      throw ShopError.invalid('请选择有效物流方案')
    }
    active.value.name = draft.value.name.trim()
    active.value.settings = clone(draft.value.settings)
    settingsOpen.value = false
  })
}
function addSheet(copy = false) {
  void run(() => {
    if (book.value.sheets.length >= 20) {
      throw ShopError.invalid('最多20个工作表')
    }
    const s = copy
      ? clone(active.value)
      : newSheet(`商品定价 ${book.value.sheets.length + 1}`, config.value.basic)
    s.id = crypto.randomUUID()
    if (copy) {
      s.name += ' 副本'
      s.rows.forEach((r) => (r.id = crypto.randomUUID()))
    }
    book.value.sheets.push(s)
    book.value.activeSheetId = s.id
    editSheet()
  })
}
const deleteOpen = ref(false)
function deleteSheet() {
  book.value.sheets = book.value.sheets.filter((s) => s.id !== active.value.id)
  book.value.activeSheetId = book.value.sheets[0]!.id
  deleteOpen.value = false
}
function addRows(count = 1) {
  void run(() => {
    if (active.value.rows.length + count > 1000) {
      throw ShopError.invalid('每表最多1000行')
    }
    active.value.rows.push(
      ...Array.from({ length: count }, () => newRow(config.value.basic)),
    )
  })
}
function onPaste(event: ClipboardEvent, r: number, c: number) {
  const text = event.clipboardData?.getData('text/plain') || ''
  if (!/[\t\n]/.test(text)) {
    return
  }
  event.preventDefault()
  void run(() => paste(active.value.rows, r, c, text, config.value.basic))
}
function nextCell(event: KeyboardEvent, r: number, c: number) {
  event.preventDefault()
  if (r === active.value.rows.length - 1 && r < 999) {
    addRows()
  }
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLInputElement>(`[data-cell="${r + 1}-${c}"]`)
      ?.focus(),
  )
}

const detailOpen = ref(false)
const rulesOpen = ref(false)
const logOpen = ref(false)
const logs = ref<
  { id: string, version: string, date: string, description: string }[] | null
>(null)
function compare(row: Product) {
  void run(() => {
    if (!hasProduct(row)) {
      throw ShopError.invalid('请先填写商品')
    }
    const available = routes(active.value.settings.date)
    if (!available.length) {
      throw ShopError.invalid('没有可用物流方案，请刷新数据')
    }
    comparison.value = {
      row: clone(row),
      settings: clone(active.value.settings),
      createdAt: new Date().toISOString(),
      entries: available.map((route) => {
        try {
          return {
            route: clone(route),
            result: calculate(row, active.value.settings, route),
            error: '',
          }
        } catch (e) {
          return { route: clone(route), result: null, error: message(e) }
        }
      }),
    }
    page.value = 'results'
  })
}
function showDetail(row: Product) {
  const value = calculated.value.get(row.id)?.values
  if (value && route.value) {
    detail.value = {
      row: clone(row),
      result: clone(value),
      route: clone(route.value),
      time: new Date().toISOString(),
    }
    detailOpen.value = true
  }
}
async function showLogs() {
  logOpen.value = true
  await run(async () => {
    const response = await props.client.api.invoke<{
      data: {
        items: {
          id: string
          version: string
          date: string
          description: string
        }[]
      }
    }>('changelog', {})
    logs.value = response.data?.items || []
  })
}
const fileInput = ref<HTMLInputElement>()
const pending = ref<Sheet[]>([])
const importOpen = ref(false)
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) {
    return
  }
  busy.value = true
  await run(async () => {
    if (file.size > 10 * 1024 * 1024) {
      throw ShopError.invalid('文件不能超过10MB')
    }
    pending.value = await importBook(
      await file.arrayBuffer(),
      config.value.basic,
      active.value.settings,
    )
    if (pending.value.length + book.value.sheets.length > 20) {
      throw ShopError.invalid('导入后总工作表不能超过20个')
    }
    importOpen.value = true
  })
  busy.value = false
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}
function confirmImport() {
  book.value.sheets.push(...pending.value)
  book.value.activeSheetId = pending.value[0]!.id
  pending.value = []
  importOpen.value = false
}
async function exportFile(template = false) {
  busy.value = true
  await run(async () => {
    for (const s of book.value.sheets) {
      await loadDate(s.settings.date)
    }
    const buffer = await exportBook(
      template ? [active.value] : book.value.sheets,
      routeFor,
      template,
    )
    download(
      buffer as ArrayBuffer,
      template ? '商品定价模板.xlsx' : '商品定价工作簿.xlsx',
    )
  })
  busy.value = false
}
let poll: ReturnType<typeof setInterval> | undefined
const visible = () => {
  if (document.hidden) {
    persist()
    return
  }
  void refreshRates()
}
async function reloadWorkspace() {
  reloadOpen.value = false
  recovery.value = true
  ready.value = false
  clearTimeout(timer)
  await saving.catch(() => {})
  error.value = ''
  try {
    const saved = await workspaceStore.load()
    if (saved) {
      book.value = saved.book
      config.value = saved.config
      detail.value = saved.detail
      comparison.value = saved.comparison
    } else {
      const initial = newSheet('商品定价 1')
      book.value = { version: 1, activeSheetId: initial.id, sheets: [initial] }
      config.value = defaultConfig()
      detail.value = null
      comparison.value = null
    }
    await nextTick()
    recovery.value = false
    ready.value = true
    dirty = false
    saveState.value = saved ? '已从云端加载' : '修改后自动保存到云端'
    await Promise.all([refreshRates(), loadDate(active.value.settings.date)])
  } catch (e) {
    saveState.value = '无法读取云端工作区'
    error.value = message(e) + '；请重试，未使用本地数据替代云端数据'
  }
}
onMounted(() => {
  unlockZoom = lockPageZoom()
  void reloadWorkspace()
  poll = setInterval(() => {
    if (!document.hidden && ready.value) {
      void refreshRates()
    }
  }, 60000)
  document.addEventListener('visibilitychange', visible)
  window.addEventListener('beforeunload', beforeUnload)
})
onUnmounted(() => {
  unlockZoom?.()
  clearInterval(poll)
  persist()
  document.removeEventListener('visibilitychange', visible)
  window.removeEventListener('beforeunload', beforeUnload)
})
async function goBack() {
  if (!ready.value) {
    await props.client.navigation.back()
    return
  }
  leaving.value = true
  try {
    if (await persist()) {
      await props.client.navigation.back()
    } else {
      leaveOpen.value = true
    }
  } finally {
    leaving.value = false
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function refreshAll() {
  void loadDate(active.value.settings.date, true)
  void refreshRates()
}
</script>

<template>
  <div class="shop-app">
    <ApplicationHeader
      title="跨境运营助手"
      back-label="OS"
      @back="goBack"
    ><template #actions><span
      class="cloud-status"
      :class="{
        'save-warning':
          (ready && recovery) || saveState === '尚未保存到云端',
      }"
      :title="saveState"
      role="status"
    >{{ compactSaveStatus }}</span><button
      class="save-workspace"
      :disabled="!ready || recovery || saveInFlight"
      @click="persist"
    >
      {{
        saveInFlight
          ? '保存中…'
          : saveState === '尚未保存到云端'
            ? '重试保存'
            : '保存'
      }}</button><button
      class="app-menu-button"
      aria-label="应用操作"
      :aria-expanded="actionsOpen"
      @click="actionsOpen = true"
    >
      •••
    </button></template></ApplicationHeader>
    <header class="shop-nav">
      <button class="brand" @click="page = 'home'">
        <span>跨</span>工具首页
      </button>
      <nav aria-label="主导航">
        <button
          v-for="item in [
            ['calculator', '商品定价'],
            ['exchange', '汇率换算'],
            ['config', '默认配置'],
          ]"
          :key="item[0]"
          :class="{
            selected:
              page === item[0]
              || (item[0] === 'calculator' && page === 'results'),
          }"
          @click="page = item[0]!"
        >
          {{ item[1] }}
        </button>
      </nav>
    </header>
    <p
      v-if="error"
      class="notice error"
      role="alert"
    >
      {{ error }} <button @click="error = ''">关闭提示</button>
    </p>
    <p
      v-if="!ready"
      class="notice"
      role="status"
    >正在读取云端工作区…</p>
    <main
      v-else
      :inert="leaving"
      class="shop-content"
      :class="[{ 'workbook-content': page === 'calculator' }]"
    >
      <template v-if="page === 'home'">
        <section class="home-intro">
          <div>
            <p class="eyebrow">跨境卖家的日常工具</p>
            <h1>把每一笔成本，<br>算进你的定价。</h1>
            <p class="intro-copy">
              从采购成本到平台费用，比较不同站点与物流方案的实际利润。
            </p>
            <button class="primary" @click="page = 'calculator'">
              开始计算 ↗
            </button>
          </div>
          <div class="cost-sheet" aria-label="定价包含的费用">
            <div class="sheet-top">一单生意的账本 <span>¥ → 本币</span></div>
            <div
              v-for="item in [
                '商品成本与境内运费',
                '站点佣金与交易手续费',
                '物流藏价与活动服务费',
                '提现手续费',
              ]"
              :key="item"
              class="sheet-line"
            >
              <span>{{ item }}</span><span>计入</span>
            </div>
            <div class="sheet-total">
              <span>最终留下的</span><strong>净利润</strong>
            </div>
          </div>
        </section>
        <div class="tool-grid">
          <button
            v-for="item in [
              [
                'calculator',
                '＋',
                '商品定价',
                '按利润、利润率或售价，比较各站点物流方案。',
                '打开计算器 →',
              ],
              [
                'exchange',
                '⇄',
                '汇率换算',
                '人民币与多种外币双向换算，查看最新更新时间。',
                '查看汇率 →',
              ],
              [
                'config',
                '≡',
                '默认配置',
                '保存常用参数，选择参与计算的站点与渠道。',
                '管理配置 →',
              ],
            ]"
            :key="item[0]"
            class="panel tool-card"
            @click="page = item[0]!"
          >
            <span class="tool-symbol">{{ item[1] }}</span><strong>{{ item[2] }}</strong>
            <p>{{ item[3] }}</p>
            <span>{{ item[4] }}</span>
          </button>
        </div>
        <button
          v-if="comparison"
          class="text-button"
          @click="page = 'results'"
        >
          查看最近方案比较
        </button>
        <button
          v-if="detail"
          class="text-button"
          @click="detailOpen = true"
        >
          查看最近计算结果 · {{ new Date(detail.time).toLocaleString() }}
        </button>
      </template>
      <template v-if="page === 'calculator'">
        <div class="toolbar workbook-toolbar">
          <div>
            <strong>商品定价工作簿</strong><small>{{ summary.ok }} 行已计算 · {{ summary.errors }} 行待处理</small>
          </div>
          <div class="actions">
            <button :disabled="busy" @click="exportFile(true)">下载模板</button><button :disabled="busy" @click="fileInput?.click()">
              导入 Excel</button><button
              class="primary"
              :disabled="busy"
              @click="exportFile()"
            >
              导出工作簿</button><input
              ref="fileInput"
              type="file"
              accept=".xlsx"
              hidden
              @change="importFile"
            >
          </div>
        </div>
        <div
          class="sheet-tabs"
          role="tablist"
          aria-label="工作表"
        >
          <button
            v-for="s in book.sheets"
            :key="s.id"
            role="tab"
            :aria-selected="s.id === active.id"
            :class="{ selected: s.id === active.id }"
            @click="book.activeSheetId = s.id"
          >
            {{ s.name }}</button><button @click="addSheet()">＋ 新增工作表</button>
        </div>
        <section class="panel workbook-panel">
          <div class="toolbar">
            <div class="route-summary">
              <strong>{{ route?.label || '尚未选择物流方案' }}</strong><small>{{ active.settings.date }} ·
                {{ modes.find((m) => m.value === active.settings.mode)?.label }}
                · {{ route?.currency || '本币' }}</small>
            </div>
            <div class="actions">
              <button @click="editSheet">工作表设置</button>
            </div>
          </div>
          <div class="toolbar grid-toolbar">
            <div class="actions grid-primary">
              <button class="add-product" @click="addRows()">＋ 添加商品</button><label class="desktop-fees"><input v-model="moreFees" type="checkbox">费率列</label><button
                class="mobile-search-trigger"
                aria-label="搜索商品"
                :aria-expanded="searchOpen"
                @click="searchOpen = !searchOpen"
              >
                搜索</button><input
                v-model="search"
                class="row-search"
                :class="{ 'is-open': searchOpen }"
                placeholder="搜索 SKU / 商品"
                aria-label="搜索商品"
              ><button class="table-options" @click="actionsOpen = true">
                更多
              </button>
            </div>
          </div>
          <TableViewport v-model="tableScale">
            <table
              class="pricing-table"
              :style="{
                '--input-columns': cols.length,
                '--output-columns': outputs.length,
              }"
            >
              <colgroup>
                <col class="number-column">
                <col
                  v-for="[key] in cols"
                  :key="key"
                  class="input-column"
                  :class="[{ 'name-column': key === 'name' }]"
                >
                <col
                  v-for="[key] in outputs"
                  :key="key"
                  class="result-column"
                >
                <col class="action-column">
              </colgroup>
              <thead>
                <tr>
                  <th class="row-number">#</th>
                  <th
                    v-for="[key, label] in cols"
                    :key="key"
                    class="input-heading"
                  >
                    {{
                      key === 'target'
                        ? modes.find((m) => m.value === active.settings.mode)
                          ?.label
                        : label
                    }}
                  </th>
                  <th v-for="[key, label] in outputs" :key="key">
                    {{ label
                    }}<small v-if="key !== 'profit' && key !== 'margin'">{{
                      route?.currency || '本币'
                    }}</small>
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="{ row, index } in shown" :key="row.id">
                  <th>{{ index + 1 }}</th>
                  <td
                    v-for="([key, label], ci) in cols"
                    :key="key"
                    class="input-cell"
                  >
                    <input
                      v-model="row[key]"
                      :data-cell="`${index}-${ci}`"
                      :aria-label="`第${index + 1}行 ${label}`"
                      :inputmode="ci < 2 ? 'text' : 'decimal'"
                      @paste="onPaste($event, index, ci)"
                      @keydown.enter="nextCell($event, index, ci)"
                    >
                  </td>
                  <td
                    v-for="[key] in outputs"
                    :key="key"
                    :class="{
                      negative: calculated.get(row.id)?.values?.[key]! < 0,
                    }"
                  >
                    <template v-if="calculated.get(row.id)?.values">{{
                      display(
                        calculated.get(row.id)!.values![key],
                        precision,
                      )
                    }}<small v-if="key !== 'profit' && key !== 'margin'">≈
                      {{
                        display(
                          calculated.get(row.id)!.values![key]
                            / route!.exchange,
                          precision,
                        )
                      }}
                      CNY</small></template><span v-else>—</span>
                  </td>
                  <td>
                    <button
                      :disabled="!calculated.get(row.id)?.values"
                      @click="showDetail(row)"
                    >
                      明细</button><button :disabled="!hasProduct(row)" @click="compare(row)">
                      比较方案</button><button
                      :aria-label="`删除第${index + 1}行`"
                      @click="active.rows.splice(index, 1)"
                    >
                      ×</button><small
                      v-if="calculated.get(row.id)?.error"
                      class="error-text"
                    >{{ calculated.get(row.id)?.error }}</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </TableViewport>
          <footer class="table-footer">
            <span>{{ active.rows.length }} 行<span class="desktop-note">
              · 蓝色输入，灰色结果</span></span>
            <div
              class="table-zoom"
              role="group"
              aria-label="表格缩放"
            >
              <button
                aria-label="缩小表格"
                :disabled="tableScale <= 0.6"
                @click="zoomTable(-0.1)"
              >
                −</button><button aria-label="重置表格缩放" @click="tableScale = 1">
                {{ Math.round(tableScale * 100) }}%</button><button
                aria-label="放大表格"
                :disabled="tableScale >= 1.8"
                @click="zoomTable(0.1)"
              >
                ＋
              </button>
            </div>
            <span class="desktop-note">{{ summary.ok }} 行已计算 · {{ summary.errors }} 行待处理</span>
          </footer>
        </section>
      </template>
      <ExchangePage
        v-if="page === 'exchange'"
        :quote="quote"
        :config="config"
        @refresh="refreshRates"
        @save="config = $event"
      />
      <ResultsPage
        v-if="page === 'results' && comparison"
        :snapshot="comparison"
        :config="config"
        @back="page = 'calculator'"
      />
      <ConfigPage
        v-if="page === 'config'"
        :config="config"
        :routes="routes(localDate(), true)"
        @save="config = $event"
        @reload="loadDate(localDate(), true)"
      />
    </main>
    <footer v-if="page !== 'calculator'" class="app-footer">
      跨境运营助手 · 商品与配置按方舟账号保存到云端
    </footer>
    <BottomSheet
      :open="actionsOpen"
      title="应用操作"
      compact
      desktop-modal
      @close="actionsOpen = false"
    ><div class="app-actions-panel">
      <p class="muted">{{ saveState }}</p>
      <div class="menu-actions">
        <button v-if="ready && !recovery" @click="action(persist)">
          {{
            saveState === '尚未保存到云端' ? '重试保存' : '立即保存'
          }}</button><button
          @click="
            action(() => (ready ? (reloadOpen = true) : reloadWorkspace()))
          "
        >
          重新加载云端
        </button>
      </div>
      <template v-if="page === 'calculator'"><h3>工作簿</h3>
        <div class="menu-actions">
          <button :disabled="busy" @click="action(() => fileInput?.click())">
            导入 Excel</button><button :disabled="busy" @click="action(() => exportFile())">
            导出工作簿</button><button :disabled="busy" @click="action(() => exportFile(true))">
            下载模板</button><button @click="action(() => addSheet())">新增工作表</button><button @click="action(() => addSheet(true))">复制工作表</button><button
            :disabled="book.sheets.length === 1"
            class="danger"
            @click="action(() => (deleteOpen = true))"
          >
            删除工作表
          </button>
        </div>
        <h3>表格与费率</h3>
        <div class="menu-actions">
          <button @click="action(() => addRows(10))">添加10行</button><button @click="action(() => (moreFees = !moreFees))">
            {{ moreFees ? '收起' : '展开' }}费率列</button><button @click="action(() => (rulesOpen = true))">
            运费费率表</button><button @click="action(showLogs)">官方更新记录</button><button @click="action(refreshAll)">刷新数据</button>
        </div>
        <details class="calculation-notes">
          <summary>使用与计算说明</summary>
          <p>
            表格支持双指缩放，也可使用底部的 − / ＋。支持 Excel 区域粘贴和
            Enter 向下填写。
          </p>
          <p>
            历史日期仅还原物流规则，佣金与汇率使用获取时数据；已有行保留独立费率，默认参数仅影响新行。
          </p>
          <p>印尼固定费沿用原项目每单3000 IDR，未核验现行政策。</p>
          <p>
            汇率：{{ quote?.source || '未获取' }} ·
            {{ quote ? new Date(quote.updatedAt).toLocaleString() : '—' }}
          </p>
        </details></template>
    </div></BottomSheet>
    <Modal
      :open="leaveOpen"
      title="尚有未保存的修改"
      @close="leaveOpen = false"
    ><p>
       当前修改尚未保存到云端，离开可能丢失。你可以返回后重试保存，或先导出工作簿备份。
     </p>
      <template #footer><button @click="exportFile()">导出工作簿</button><button @click="leaveOpen = false">返回编辑</button><button class="danger" @click="client.navigation.back()">
        放弃修改并离开
      </button></template></Modal>
    <Modal
      :open="reloadOpen"
      title="重新加载云端工作区"
      @close="reloadOpen = false"
    ><p>
       重新加载将放弃本页尚未保存的修改。需要保留这些商品时，请先导出 Excel
       备份。
     </p>
      <template #footer><button @click="exportFile()">导出工作簿</button><button @click="reloadOpen = false">取消</button><button class="primary" @click="reloadWorkspace">
        重新加载云端
      </button></template></Modal>
    <EditDialog
      :open="settingsOpen"
      title="工作表设置"
      long
      @close="settingsOpen = false"
      @save="saveSheet"
    ><p
       v-if="error"
       class="error-text"
       role="alert"
     >{{ error }}</p>
      <div class="fields">
        <label>工作表名称<input v-model="draft.name" maxlength="100"></label><label>物流费率日期<input
          v-model="draft.settings.date"
          type="date"
        ></label><label>计算模式<SheetSelect
          v-model="draft.settings.mode"
          :options="modes"
          label="计算模式"
          desktop-modal
        /></label><label>物流方案<RoutePicker
          v-model="draft.settings.routeKey"
          :routes="draftRoutes"
        /></label>
      </div>
      <p class="muted">
        切换日期重新获取物流规则；历史日期不会还原佣金与汇率。
      </p></EditDialog>
    <Modal
      :open="deleteOpen"
      title="删除工作表"
      @close="deleteOpen = false"
    ><p>删除「{{ active.name }}」及其商品数据？此操作无法撤销。</p>
      <template #footer><button @click="deleteOpen = false">取消</button><button class="danger" @click="deleteSheet">删除</button></template></Modal>
    <Modal
      :open="importOpen"
      title="导入预览"
      class="shop-dialog"
      @close="importOpen = false"
    ><p>将追加以下工作表，现有数据保留。结果使用获取到的费率重新计算。</p>
      <ul>
        <li v-for="s in pending" :key="s.id">
          {{ s.name }} · {{ s.rows.length }} 行 · {{ s.settings.date }} ·
          {{ s.settings.mode }}
        </li>
      </ul>
      <template #footer><button @click="importOpen = false">取消</button><button class="primary" @click="confirmImport">
        确认追加
      </button></template></Modal>
    <Modal
      :open="rulesOpen"
      title="运费费率表"
      class="shop-dialog shop-dialog-long"
      @close="rulesOpen = false"
    ><p>
       {{ route?.label || '请先选择物流方案' }} · {{ active.settings.date }}
     </p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>对象</th>
              <th>规则</th>
              <th>起重 g</th>
              <th>止重 g</th>
              <th>金额</th>
              <th>续重 g</th>
              <th>续重单价</th>
              <th>生效 / 结束日期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(fee, i) in route?.fees || []" :key="i">
              <td>{{ fee.type === 'Seller' ? '卖家' : '买家' }}</td>
              <td>{{ fee.name }}</td>
              <td>{{ fee.start_weight ?? 0 }}</td>
              <td>{{ fee.end_weight || '不限' }}</td>
              <td>{{ fee.original_fee ?? '—' }}</td>
              <td>{{ fee.increment_unit ?? '—' }}</td>
              <td>{{ fee.increment_amount ?? '—' }}</td>
              <td>
                {{ fee.start_date || fee.effective_date || '—' }} /
                {{ fee.end_date || fee.last_effective_date || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div></Modal>
    <Modal
      :open="logOpen"
      title="官方更新记录"
      class="shop-dialog shop-dialog-long"
      @close="logOpen = false"
    >
      <p v-if="!logs">正在加载…</p>
      <p v-else-if="!logs.length">暂无更新记录</p>
      <article
        v-for="item in logs || []"
        :key="item.id"
        class="log-item"
      >
        <strong>v{{ item.version }} · {{ item.date }}</strong>
        <p>{{ item.description }}</p>
      </article>
    </Modal>
    <Modal
      :open="detailOpen"
      title="计算结果明细"
      class="shop-dialog shop-dialog-long"
      @close="detailOpen = false"
    ><template v-if="detail"><p>
                               {{ detail.row.sku }} {{ detail.row.name }} · {{ detail.route.label }}
                             </p>
      <p class="muted">
        {{ new Date(detail.time).toLocaleString() }} · 市场汇率
        {{ detail.route.exchange }} · 定价汇率
        {{ detail.result.pricingExchange }}
      </p>
      <dl class="summary">
        <div v-for="[key, label] in outputs" :key="key">
          <dt>{{ label }}</dt>
          <dd>
            {{ display(detail.result[key] ?? (key === 'paid' ? detail.result.sale : 0), detail.route.precision ?? Number(config.basic.precision)) }}
            {{
              key === 'profit'
                ? 'CNY'
                : key === 'margin'
                  ? '%'
                  : detail.route.currency
            }}
          </dd>
        </div>
      </dl>
      <p>藏价：{{ detail.result.sellerFormula }}</p>
      <p>买家运费：{{ detail.result.buyerFormula }}</p>
      <p class="muted">
        净利润 =（订单收入 − 提现费 − 预留汇损）÷ 市场汇率 − 成本 −
        境内运费。印尼沿用每单3000 IDR固定交易费，尚未核验现行政策。
      </p></template></Modal>
  </div>
</template>
