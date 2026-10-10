<script setup lang="ts">
import type {
  PaymentOrder,
  UsageRecord,
  Wallet,
  WalletEntry,
} from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onMounted, ref } from 'vue'
import {
  backFromApplication,
  openPricing,
  openRecharge,
} from '../../core/navigation'
import { request } from '../../core/network'
import { displayMoney as fee } from './format'
import './wallet.css'

const wallet = ref<Wallet | null>(null)
const usage = ref<UsageRecord[]>([])
const entries = ref<WalletEntry[]>([])
const orders = ref<PaymentOrder[]>([])
const loading = ref(true)
const error = ref('')
const tab = ref<'usage' | 'entries' | 'orders'>('usage')
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
  review: '待核对',
  released: '预留已解除',
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [w, u, e, o] = await Promise.all([
      request<{ data: Wallet }>('/wallet'),
      request<{ data: UsageRecord[] }>('/wallet/usage'),
      request<{ data: WalletEntry[] }>('/wallet/entries'),
      request<{ data: PaymentOrder[] }>('/payments/orders'),
    ])
    wallet.value = w.data
    usage.value = u.data
    entries.value = e.data
    orders.value = o.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取余额失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="wallet-page">
    <ApplicationHeader
      title="我的余额"
      back-label="AI"
      @back="backFromApplication"
    >
      <template #actions>
        <button
          class="wallet-refresh"
          aria-label="刷新余额"
          :disabled="loading"
          @click="load"
        >
          <AppIcon name="refresh" :size="19" />
        </button>
      </template>
    </ApplicationHeader>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="wallet-card">
      <div class="wallet-card-label">
        <span>可用余额 / 元</span><span
          v-if="wallet?.mode === 'record_only'"
          class="wallet-free-label"
        >仅记录费用</span>
      </div>
      <strong>{{ wallet ? fee(wallet.available) : "—" }}</strong>
      <div class="wallet-card-footer">
        <span>{{
          wallet && wallet.reserved !== "0.000000"
            ? `预留 ${fee(wallet.reserved)} 元`
            : "按实际用量结算"
        }}</span><button @click="openRecharge()">
          <AppIcon name="plus" :size="16" />充值
        </button>
      </div>
    </div>
    <p class="wallet-description">
      {{
        wallet?.mode === "record_only"
          ? "你的使用会记录费用，不从余额扣款。"
          : "会话按用量计费，图片按张计费。标题生成免费。"
      }}
      <button class="wallet-pricing-link" @click="openPricing">
        AI 费用说明<AppIcon name="right" :size="13" />
      </button>
    </p>
    <nav class="wallet-tabs" aria-label="余额记录">
      <button
        v-for="t in [
          { id: 'usage', name: '使用记录' },
          { id: 'entries', name: '余额明细' },
          { id: 'orders', name: '充值订单' },
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
    <template v-else-if="tab === 'usage'">
      <div v-if="!usage.length" class="wallet-empty">
        <AppIcon name="chat" :size="28" />
        <p>还没有使用记录</p>
        <small>开始对话后，费用会记录在这里</small>
      </div>
      <ol v-else class="wallet-records">
        <li v-for="r in usage" :key="r.id">
          <span class="wallet-record-icon"><AppIcon
            :name="r.kind === 'image' ? 'image' : 'chat'"
            :size="19"
          /></span>
          <div>
            <h3>{{ r.kind === "image" ? "图片处理" : "AI 会话" }}</h3>
            <p>{{ date(r.createdAt) }} · {{ status[r.status] }}</p>
            <small v-if="r.mode === 'record_only' && r.status === 'settled'">费用 ¥{{ fee(r.fee) }}，本次免扣</small>
          </div>
          <strong>{{
            r.status === "reserved" || r.status === "review"
              ? "待结算"
              : `¥${fee(r.charged)}`
          }}</strong>
        </li>
      </ol>
    </template>
    <template v-else-if="tab === 'entries'">
      <div v-if="!entries.length" class="wallet-empty">
        <AppIcon name="wallet" :size="28" />
        <p>暂无余额变动</p>
      </div>
      <ol v-else class="wallet-records">
        <li v-for="e in entries" :key="e.id">
          <span class="wallet-record-icon"><AppIcon
            :name="e.kind === 'usage' ? 'arrowUp' : 'arrowDown'"
            :size="19"
          /></span>
          <div>
            <h3>
              {{
                e.kind === "usage"
                  ? "服务费用"
                  : e.kind === "recharge"
                    ? "充值到账"
                    : "余额赠送"
              }}
            </h3>
            <p>{{ date(e.createdAt) }} · 余额 ¥{{ fee(e.balance) }}</p>
          </div>
          <strong :class="{ credit: e.kind !== 'usage' }">{{ e.amount.startsWith("-") ? "" : "+"
          }}{{ fee(e.amount) }}</strong>
        </li>
      </ol>
    </template>
    <template v-else>
      <div v-if="!orders.length" class="wallet-empty">
        <AppIcon name="wallet" :size="28" />
        <p>暂无充值订单</p>
      </div>
      <ol v-else class="wallet-records">
        <li v-for="o in orders" :key="o.id">
          <span class="wallet-record-icon"><AppIcon
            name="wallet"
            :size="19"
          /></span>
          <div>
            <h3>余额充值 · ¥{{ fee(o.amount) }}</h3>
            <small v-if="Number(o.bonusAmount) > 0">赠送 ¥{{ fee(o.bonusAmount) }} · 到账 ¥{{
              fee(o.creditedAmount)
            }}</small>
            <p>
              {{ date(o.createdAt) }} ·
              {{
                o.status === "paid"
                  ? "已到账"
                  : o.status === "closed"
                    ? "已关闭"
                    : Date.parse(o.expiresAt) <= Date.now()
                      ? "已过期"
                      : "待支付"
              }}
            </p>
          </div>
          <button
            v-if="
              o.status === 'pending' && Date.parse(o.expiresAt) > Date.now()
            "
            class="wallet-pay"
            @click="openRecharge(o.id)"
          >
            查看订单
          </button>
        </li>
      </ol>
    </template>
    <p
      v-if="
        !loading
          && (tab === 'usage'
            ? usage.length
            : tab === 'entries'
              ? entries.length
              : orders.length)
      "
      class="wallet-limit"
    >
      显示最近 100 条记录
    </p>
  </section>
</template>
