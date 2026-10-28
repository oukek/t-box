<script setup lang="ts">
import type { AdminPaymentOrder, PaymentCapabilities } from '@t-box/shared'
import { computed, onMounted, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request, save } from '../core/api'
import ReconciliationPanel from './ReconciliationPanel.vue'
import RefundsPanel from './RefundsPanel.vue'
import WechatSettings from './WechatSettings.vue'
import './wechat-management.css'

const orders = ref<AdminPaymentOrder[]>([])
const enabled = ref(false)
const disabledReason = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const settingsOpen = ref(false)
const selected = ref<AdminPaymentOrder | null>(null)
const section = ref('orders')
const query = ref('')
const filter = ref('all')
const now = ref(Date.now())
const modes = ref<string[]>([])
const modeNames: Record<string, string> = { jsapi: '微信网页支付', h5: 'H5 支付', native: 'Native 扫码', app: 'APP 支付' }
const statusNames = { paid: '已到账', pending: '待支付', closed: '已关闭', expired: '已过期' }
function status(order: AdminPaymentOrder): keyof typeof statusNames {
  return order.status === 'pending' && Date.parse(order.expiresAt) <= now.value ? 'expired' : order.status
}
const filterOptions = [{ value: 'all', label: '全部状态' }, ...Object.entries(statusNames).map(([value, label]) => ({ value, label }))]
const filtered = computed(() => orders.value.filter((order) => {
  const text = query.value.trim().toLowerCase()
  return (filter.value === 'all' || status(order) === filter.value) && (!text || [order.id, order.packageName, order.nickname, order.username, order.userId].some((value) => value?.toLowerCase().includes(text)))
}))
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false })
function price(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`
}
function clearFilters() {
  query.value = ''
  filter.value = 'all'
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [items, caps] = await Promise.all([
      request<AdminPaymentOrder[]>('/payments/orders'),
      request<PaymentCapabilities>('/payments/capabilities'),
    ])
    orders.value = items
    enabled.value = caps.enabled
    modes.value = caps.modes || []
    now.value = Date.now()
    disabledReason.value = caps.disabledReason || '在线购买未开放，请检查微信支付配置中的总开关和支付渠道。'
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
async function reconcile() {
  if (!selected.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await save(`/payments/orders/${selected.value.id}/reconcile`, {})
    selected.value = null
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="wechat-management payments-management">
    <header class="page-heading">
      <div><p class="eyebrow">交易与权益</p><h1>支付订单</h1><p>查看资源包充值，处理退款与微信账单核对。</p></div>
      <div class="payment-header-actions"><AdminButton :disabled="loading" @click="load">刷新</AdminButton><AdminButton class="primary" @click="settingsOpen = true"><AdminIcon name="edit" :size="15" />微信支付配置</AdminButton></div>
    </header>
    <p
      v-if="error"
      class="alert"
      role="alert"
    >{{ error }}</p>
    <section
      v-if="!loading && !error"
      class="payment-channel-summary"
      :class="{ inactive: !enabled }"
      aria-label="在线购买状态"
    >
      <span class="wechat-section-icon"><AdminIcon :name="enabled ? 'check' : 'lock'" :size="20" /></span>
      <div><div class="payment-channel-heading"><strong>在线购买{{ enabled ? '已开放' : '尚未开放' }}</strong><span
        v-for="mode in modes"
        :key="mode"
        class="payment-mode-pill"
      >{{ modeNames[mode] || mode }}</span></div><p>{{ enabled ? '付款由微信处理，到账以服务端核对结果为准。' : disabledReason }}</p></div>
      <a href="#/wechat-login">微信登录设置<AdminIcon name="arrow" :size="14" /></a>
    </section>
    <nav class="payment-sections" aria-label="支付记录分类">
      <AdminButton
        v-for="item in [{ id: 'orders', label: '充值订单' }, { id: 'refunds', label: '退款记录' }, { id: 'reconciliation', label: '账单核对' }]"
        :key="item.id"
        type="button"
        :aria-pressed="section === item.id"
        :class="{ active: section === item.id }"
        @click="section = item.id"
      >{{ item.label }}<span v-if="item.id === 'orders' && !loading">{{ orders.length }}</span></AdminButton>
    </nav>
    <section v-if="section === 'orders'" class="panel payment-orders-panel">
      <div class="payment-orders-toolbar"><div><h2>充值订单</h2><p>最近 100 笔订单<span v-if="query || filter !== 'all'"> · 找到 {{ filtered.length }} 笔</span></p></div><div class="payment-filters"><label class="payment-order-search"><AdminIcon name="search" :size="16" /><AdminInput
        v-model="query"
        type="search"
        placeholder="搜索订单、用户或资源包"
        aria-label="搜索订单"
      /></label><AdminSelect
        v-model="filter"
        :options="filterOptions"
        label="订单状态"
      /></div></div>
      <div v-if="loading" class="empty">正在读取订单…</div>
      <div v-else-if="!filtered.length" class="payment-empty"><span class="wechat-section-icon"><AdminIcon name="model" :size="24" /></span><h3>{{ orders.length ? '没有匹配的订单' : '还没有充值订单' }}</h3><p>{{ orders.length ? '试试其他关键词或订单状态。' : '用户购买资源包后，订单和到账状态会显示在这里。' }}</p><AdminButton v-if="orders.length" @click="clearFilters">清除筛选</AdminButton></div>
      <div v-else class="table-wrap"><table class="payment-orders-table"><thead><tr><th>订单 / 资源包</th><th>充值账号</th><th class="payment-amount-column">实付金额</th><th>订单状态</th><th>创建 / 到账时间</th><th class="actions-heading">操作</th></tr></thead><tbody><tr v-for="order in filtered" :key="order.id"><td><strong>{{ order.packageName }}<span class="payment-version">v{{ order.packageVersion }}</span></strong><span class="payment-order-id" :title="order.id">{{ order.id }}</span><small>{{ order.quota }} 额度 · 赠 {{ order.bonusQuota }} 额度</small></td><td><strong>{{ order.nickname || order.username || '方舟' }}</strong><span class="cell-secondary">账号尾号 {{ order.userId?.slice(-6) || '—' }}</span></td><td class="payment-amount-column"><strong class="payment-order-amount">¥{{ price(order.amount) }}</strong></td><td><span class="payment-status" :class="status(order)">{{ statusNames[status(order)] }}</span></td><td class="payment-time"><span>{{ time(order.createdAt) }}</span><small>{{ order.paidAt ? `到账 ${time(order.paidAt)}` : '尚未到账' }}</small></td><td class="actions"><AdminButton :disabled="busy" @click="selected = order">渠道核对<AdminIcon name="arrow" :size="13" /></AdminButton></td></tr></tbody></table></div>
      <p v-if="orders.length" class="payment-table-note"><AdminIcon name="lock" :size="13" />到账与权益发放由服务端校验，重复通知不会重复充值。</p>
    </section>
    <section v-else-if="section === 'refunds'" class="panel payment-secondary-panel"><RefundsPanel :orders="orders" @updated="load" /></section>
    <section v-else class="panel payment-secondary-panel"><ReconciliationPanel /></section>
    <WechatSettings
      :open="settingsOpen"
      @close="settingsOpen = false"
      @saved="load"
    />
    <AdminDialog
      :open="!!selected"
      title="核对微信支付结果"
      :description="selected?.id"
      :busy="busy"
      compact
      @close="selected = null"
    >
      <div v-if="selected" class="payment-reconcile-summary"><strong>{{ selected.packageName }}</strong><span>¥{{ price(selected.amount) }} · {{ selected.nickname || '方舟' }}</span></div><p>查询微信实际支付结果。只有金额、商户与订单一致且已付款，才会更新到账状态。</p><p class="muted">此操作不会直接将订单标记为已支付，重复核对不会重复发放额度。</p>
      <template #footer><AdminButton :disabled="busy" @click="selected = null">取消</AdminButton><AdminButton
        class="primary"
        :disabled="busy"
        @click="reconcile"
      >{{ busy ? '正在核对…' : '核对支付结果' }}</AdminButton></template>
    </AdminDialog>
  </div>
</template>
