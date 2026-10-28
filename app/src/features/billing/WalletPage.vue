<script setup lang="ts">
import type {
  PaymentCapabilities,
  PaymentOrder,
  PaymentRefund,
  QuotaLot,
  UsageRecord,
  Wallet,
  WalletEntry,
} from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onMounted, ref } from 'vue'
import {
  backFromApplication,
  openPricing,
  openRecharge,
} from '../../core/navigation'
import { request } from '../../core/network'
import CheckoutDialog from './CheckoutDialog.vue'
import { displayMoney as fee, quotaPercentage } from './format'
import { usePaymentClock } from './paymentClock'
import { useQuotaRefresh } from './quota-events'
import { purchaseBlockReason, useWechatCheckout } from './wechatCheckout'
import './wallet.css'

const wallet = ref<Wallet | null>(null)
const lots = ref<QuotaLot[]>([])
const usage = ref<UsageRecord[]>([])
const entries = ref<WalletEntry[]>([])
const orders = ref<PaymentOrder[]>([])
const refunds = ref<PaymentRefund[]>([])
const capabilities = ref<PaymentCapabilities>({ enabled: false, channel: 'wechat', modes: [] })
const checkout = useWechatCheckout(() => load(true), () => capabilities.value.modes)
const now = usePaymentClock()
const activeLots = computed(() => lots.value.filter((lot) => Date.parse(lot.expiresAt) > now.value && Number(lot.available) > 0))
const nextExpiry = computed(() => activeLots.value.map((lot) => lot.expiresAt).sort()[0])
const pendingOrders = computed(() => orders.value.filter((order) => order.status === 'pending' && Date.parse(order.expiresAt) > now.value))
const refundLabels = {
  prepared: '待处理',
  processing: '退款处理中',
  uncertain: '渠道核对中',
  abnormal: '渠道异常',
  succeeded: '已退款',
  closed: '退款已关闭',
}
const loading = ref(true)
const error = ref('')
const tab = ref<'lots' | 'usage' | 'entries' | 'orders' | 'refunds'>('lots')
const date = (s: string) =>
  new Date(s).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
const status = {
  reserved: '处理中',
  settled: '已结算',
  review: '待核对 · 不扣额度',
  released: '已释放',
  reversed: '失败已退回',
}
const kinds = {
  purchase: '购买到账',
  grant: '赠送额度',
  reserve: '预占额度',
  release: '释放预占',
  consume: '使用扣减',
  reverse: '失败退回',
  expire: '额度到期',
  revoke: '退款收回',
}
let revision = 0
async function load(silent = false) {
  const id = ++revision
  if (!silent) {
    loading.value = true
  }
  error.value = ''
  try {
    const [w, l, u, e, o, f, c] = await Promise.all([
      request<{ data: Wallet }>('/wallet'),
      request<{ data: QuotaLot[] }>('/wallet/lots'),
      request<{ data: UsageRecord[] }>('/wallet/usage'),
      request<{ data: WalletEntry[] }>('/wallet/entries'),
      request<{ data: PaymentOrder[] }>('/payments/orders'),
      request<{ data: PaymentRefund[] }>('/wallet/refunds'),
      request<{ data: PaymentCapabilities }>('/payments/capabilities').catch(() => ({ data: { enabled: false, channel: 'wechat' as const, modes: [] } })),
    ])
    if (id !== revision) {
      return
    }
    wallet.value = w.data
    lots.value = l.data
    usage.value = u.data
    entries.value = e.data
    orders.value = o.data
    refunds.value = f.data
    capabilities.value = c.data
  } catch (cause) {
    if (id === revision) {
      error.value = cause instanceof Error ? cause.message : '读取额度失败'
    }
  } finally {
    if (id === revision) {
      loading.value = false
    }
  }
}
useQuotaRefresh(() => load(true))
onMounted(() => load())
</script>

<template>
  <section class="wallet-page">
    <ApplicationHeader
      title="我的额度"
      back-label="AI"
      @back="backFromApplication"
    ><template #actions><button
      class="wallet-refresh"
      aria-label="刷新额度"
      :disabled="loading"
      @click="load()"
    >
      <AppIcon name="refresh" :size="19" /></button></template></ApplicationHeader>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >{{ error }}</p>
    <section class="wallet-overview" aria-label="额度概览">
      <div class="wallet-overview-main"><div><span class="billing-eyebrow">AI 服务额度</span><p class="wallet-balance-label">当前可用</p><strong class="wallet-balance">{{ wallet ? fee(wallet.available) : '—' }}<small>额度</small></strong><p class="wallet-reserved">{{ wallet && Number(wallet.reserved) > 0 ? `处理中预占 ${fee(wallet.reserved)} 额度` : '优先使用最早到期的资源包' }}</p></div><div class="wallet-overview-actions"><span v-if="wallet?.mode === 'record_only'" class="wallet-free-label">当前免扣额度</span><button class="button button-primary" @click="openRecharge()"><AppIcon name="plus" :size="16" />购买资源包</button><button class="wallet-pricing-link" @click="openPricing">AI 费用说明<AppIcon name="right" :size="14" /></button></div></div>
      <dl class="wallet-overview-stats"><div><dt>有效资源包</dt><dd>{{ activeLots.length }}<small>份</small></dd></div><div><dt>最早到期</dt><dd>{{ nextExpiry ? new Date(nextExpiry).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—' }}</dd></div><div><dt>待支付订单</dt><dd>{{ pendingOrders.length }}<small>笔</small></dd></div></dl>
    </section>
    <section class="wallet-record-panel" aria-label="额度记录明细">
      <nav class="wallet-tabs" aria-label="额度记录">
        <button
          v-for="t in [
            { id: 'lots', name: '资源包' },
            { id: 'usage', name: '使用记录' },
            { id: 'entries', name: '额度流水' },
            { id: 'orders', name: '购买订单' },
            { id: 'refunds', name: '退款记录' },
          ] as const"
          :key="t.id"
          :class="{ active: tab === t.id }"
          :aria-current="tab === t.id ? 'page' : undefined"
          @click="tab = t.id"
        >
          {{ t.name }}
        </button>
      </nav>
      <div v-if="loading" class="wallet-empty">正在读取记录…</div>
      <template v-else-if="tab === 'lots'">
        <div v-if="!lots.length" class="wallet-empty">
          <AppIcon name="wallet" :size="28" />
          <p>还没有资源包</p>
          <small>购买或获得赠送后，在这里查看剩余与有效期</small>
        </div>
        <ol v-else class="wallet-records">
          <li v-for="lot in lots" :key="lot.id">
            <span class="wallet-record-icon"><AppIcon
              name="wallet"
              :size="19"
            /></span>
            <div>
              <h3>{{ lot.name }}</h3>
              <p>
                {{ new Date(lot.expiresAt).toLocaleDateString() }} 到期{{
                  Date.parse(lot.expiresAt) <= Date.now() ? ' · 已到期' : ''
                }}
              </p>
              <small>剩余 {{ quotaPercentage(lot.available, lot.total) }}% · 已使用
                {{ fee(lot.consumed) }} / {{ fee(lot.total)
                }}<template v-if="Number(lot.reserved)">
                  · 预占 {{ fee(lot.reserved) }}</template></small><small v-if="Number(lot.expired) || Number(lot.revoked)">已过期 {{ fee(lot.expired) }} · 已收回
                {{ fee(lot.revoked) }}</small>
            </div>
            <strong>{{ fee(lot.available)
            }}<small class="quota-unit"> 可用</small></strong>
          </li>
        </ol>
      </template>
      <template v-else-if="tab === 'usage'">
        <div v-if="!usage.length" class="wallet-empty">还没有使用记录</div>
        <ol v-else class="wallet-records">
          <li v-for="r in usage" :key="r.id">
            <span class="wallet-record-icon"><AppIcon
              :name="r.kind === 'image' ? 'image' : 'chat'"
              :size="19"
            /></span>
            <div>
              <h3>
                {{
                  r.purpose === 'title'
                    ? '会话标题 · 平台承担'
                    : r.purpose === 'memory_extraction'
                      ? '记忆整理 · 平台承担'
                      : r.purpose === 'compaction'
                        ? '上下文整理 · 平台承担'
                        : r.kind === 'image'
                          ? `图片处理 · ${(r.imageTier ?? '1k').toUpperCase()}`
                          : 'AI 会话'
                }}
              </h3>
              <p>{{ date(r.createdAt) }} · {{ status[r.status] }}</p>
              <small v-if="r.mode === 'record_only' && r.status === 'settled'">应扣 {{ fee(r.fee) }} 额度，本次免扣</small>
              <details v-if="r.allocations?.length">
                <summary>资源包分摊</summary>
                <small
                  v-for="a in r.allocations"
                  :key="a.lotId"
                >{{ a.name }} · 扣 {{ fee(a.consumed) }} · 退
                  {{ fee(a.returned) }}</small>
              </details>
            </div>
            <strong>{{ fee(r.charged) }}<small class="quota-unit"> 额度</small></strong>
          </li>
        </ol>
      </template>
      <template v-else-if="tab === 'entries'">
        <div v-if="!entries.length" class="wallet-empty">暂无额度变动</div>
        <ol v-else class="wallet-records">
          <li v-for="e in entries" :key="e.id">
            <div>
              <h3>{{ kinds[e.kind] }}</h3>
              <p>
                {{ date(e.createdAt)
                }}<template v-if="e.reason"> · {{ e.reason }}</template>
              </p>
            </div>
            <strong>{{ fee(e.amount) }}<small class="quota-unit"> 额度</small></strong>
          </li>
        </ol>
      </template>
      <template v-else-if="tab === 'orders'">
        <div v-if="!orders.length" class="wallet-empty">暂无购买订单</div>
        <ol v-else class="wallet-records">
          <li v-for="o in orders" :key="o.id">
            <div>
              <h3>{{ o.packageName }} · ¥{{ fee(o.amount) }}</h3>
              <small>{{ o.quota }} 额度，赠 {{ o.bonusQuota }} ·
                {{ o.validDays }} 天</small>
              <p>
                {{ date(o.createdAt) }} ·
                {{
                  o.status === 'paid'
                    ? '已到账'
                    : o.status === 'closed'
                      ? '已关闭'
                      : Date.parse(o.expiresAt) <= now
                        ? '已过期'
                        : '待支付'
                }}
              </p>
            </div>
            <button class="wallet-pay" @click="checkout.view(o)">查看详情<AppIcon name="right" :size="12" /></button>
          </li>
        </ol>
      </template>
      <template v-else>
        <div v-if="!refunds.length" class="wallet-empty">暂无退款记录</div>
        <ol v-else class="wallet-records">
          <li v-for="r in refunds" :key="r.id">
            <div>
              <h3>{{ refundLabels[r.status] }}</h3>
              <p>
                {{ date(r.createdAt) }} · 收回 {{ fee(r.reclaimedQuota) }} 额度
              </p>
              <small>订单 {{ r.orderId.slice(0, 8) }} · {{ r.reason }}</small>
            </div>
            <strong>¥{{ fee(r.amount) }}</strong>
          </li>
        </ol>
      </template>
      <p class="wallet-limit">显示最近 100 条记录，已购资源包保留购买时的权益。</p>
    </section>
    <CheckoutDialog
      :open="checkout.open.value"
      :order="checkout.order.value"
      :qr="checkout.qr.value"
      :link="checkout.link.value"
      :phase="checkout.phase.value"
      :expires-at="checkout.expiresAt.value"
      :details="checkout.details.value"
      :notice="checkout.notice.value"
      :error="checkout.error.value"
      :checking="checkout.checking.value"
      :cancelling="checkout.cancelling.value"
      :unavailable="!!purchaseBlockReason() || !capabilities.enabled"
      @close="checkout.close"
      @refresh="checkout.refresh"
      @cancel-order="checkout.cancelOrder"
      @continue="checkout.order.value && checkout.pay(checkout.order.value)"
    />
  </section>
</template>

<style scoped>
.quota-unit {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}
.wallet-records details {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.wallet-tabs {
  overflow-x: auto;
}
.wallet-tabs button {
  white-space: nowrap;
}
</style>
