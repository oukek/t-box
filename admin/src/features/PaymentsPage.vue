<script setup lang="ts">
import type { AdminPaymentOrder, PaymentCapabilities } from '@t-box/shared'
import { onMounted, ref } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import { errorMessage, request, save } from '../core/api'
import WechatSettings from './WechatSettings.vue'

const orders = ref<AdminPaymentOrder[]>([])
const enabled = ref(false)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const settingsOpen = ref(false)
const selected = ref<AdminPaymentOrder | null>(null)
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
  <header class="page-heading">
    <div>
      <p class="eyebrow">PAYMENTS</p>
      <h1>支付订单</h1>
      <p>充值订单与余额入账由服务端确认。</p>
    </div>
    <div class="actions">
      <button @click="settingsOpen = true">微信支付配置</button><button :disabled="loading" @click="load">刷新</button>
    </div>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
  <p v-if="!loading && !enabled" class="alert">
    在线充值未开放，请在“微信支付配置”中填写商户信息并启用对应支付方式。
  </p>
  <section class="panel">
    <div class="panel-heading">
      <h2>最近订单</h2>
      <span class="muted">最多 100 条</span>
    </div>
    <div v-if="loading" class="empty">正在读取订单…</div>
    <div v-else-if="!orders.length" class="empty">暂无充值订单</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>订单号</th>
            <th>实付 / 元</th>
            <th>状态</th>
            <th>创建 / 支付时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id">
            <td class="mono">
              {{ o.id }}
            </td>
            <td>
              {{ o.amount
              }}<span
                v-if="Number(o.bonusAmount) > 0"
                class="cell-secondary"
              >赠 ¥{{ Number(o.bonusAmount) }} · 到账 ¥{{
                Number(o.creditedAmount)
              }}</span>
            </td>
            <td>
              <span class="badge" :class="{ disabled: o.status !== 'paid' }">{{
                o.status === "paid"
                  ? "已支付"
                  : o.status === "closed"
                    ? "已关闭"
                    : Date.parse(o.expiresAt) <= Date.now()
                      ? "已过期，待渠道核对"
                      : "待支付"
              }}</span>
            </td>
            <td>
              {{ new Date(o.createdAt).toLocaleString()
              }}<span class="cell-secondary">{{
                o.paidAt ? new Date(o.paidAt).toLocaleString() : "—"
              }}</span>
            </td>
            <td class="actions">
              <button :disabled="!enabled || busy" @click="selected = o">
                渠道核对
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <p class="footnote">
    渠道核对会查询微信实际支付结果，并幂等入账。后台不提供“手动标记支付成功”。
  </p>
  <WechatSettings
    :open="settingsOpen"
    @close="settingsOpen = false"
    @saved="load"
  />
  <AdminDialog
    :open="!!selected"
    title="核对支付结果"
    :description="selected?.id"
    :busy="busy"
    compact
    @close="selected = null"
  >
    <p>
      查询支付渠道的真实结果。仅核对成功支付、金额一致的订单，重复核对不会重复入账。
    </p>
    <template #footer>
      <button :disabled="busy" @click="selected = null">取消</button><button
        class="primary"
        :disabled="busy"
        @click="reconcile"
      >
        {{ busy ? "正在核对…" : "开始核对" }}
      </button>
    </template>
  </AdminDialog>
</template>
