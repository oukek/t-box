<script setup lang="ts">
import type { PaymentIntent, PaymentOrder, WechatCheckoutPreview, WechatJsSdkConfiguration } from '@t-box/shared'
import { AppIcon, Modal, UserAvatar } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { navigateTab } from '../../core/navigation'
import { request, RequestError } from '../../core/network'
import { watchQrState } from '../../core/qrSocket'
import { identity } from '../../core/session'
import { inWechat, startWechatCheckoutLogin } from '../identity/wechatLogin'
import { takeCheckoutAuthentication, takeCheckoutTicket } from './checkoutLink'
import { displayMoney } from './format'
import { isWechatPayBrowser } from './paymentEnvironment'
import { chooseWechatPay } from './wechatJsSdk'

const phase = ref<'loading' | 'confirm' | 'paying' | 'pending' | 'paid' | 'cancelled' | 'error' | 'consumed' | 'outside' | 'login'>('loading')
const preview = ref<WechatCheckoutPreview | null>(null)
const error = ref('')
const cancelling = ref(false)
let ticket: string | null = null
let disposed = false
let inspecting = false
let stopUpdates: (() => void) | undefined
async function call<T>(path: string, body: Record<string, unknown> = {}) {
  return (await request<{ data: T }>(`/payments/handoff/${path}`, { method: 'POST', body: JSON.stringify({ ticket, ...body }), timeoutMs: 25_000 })).data
}
async function refreshStatus() {
  if (disposed) {
    return
  }
  try {
    const order = await call<PaymentOrder>('refresh')
    if (disposed) {
      return
    }
    if (preview.value) {
      preview.value.order = order
    }
    if (order.status === 'paid') {
      phase.value = 'paid'
      return
    }
    if (order.status === 'closed' || Date.parse(order.expiresAt) <= Date.now()) {
      throw new Error('订单已关闭或过期，请返回原设备核对订单。')
    }
    error.value = ''
  } catch (cause) {
    if (disposed) {
      return
    }
    if (!identity.user) {
      phase.value = 'login'
    }
    error.value = cause instanceof Error ? cause.message : '核对支付结果失败'
  }
}
function watchPayment() {
  if (!ticket || stopUpdates) {
    return
  }
  stopUpdates = watchQrState({ type: 'handoff', token: identity.token, ticket }, (event) => {
    if (disposed || event.type !== 'payment.state') {
      return
    }
    if (preview.value) {
      preview.value.order = event.data.order
    }
    if (event.data.order.status === 'paid') {
      phase.value = 'paid'
      error.value = ''
      stopUpdates?.()
      stopUpdates = undefined
    } else if (event.data.stage === 'closed' || event.data.stage === 'expired') {
      phase.value = 'error'
      error.value = '订单或二维码已关闭、过期，请返回原设备核对。'
    }
  }, (message) => {
    if (!disposed && phase.value !== 'paid') {
      error.value = message
    }
  })
}
async function cancelPayment() {
  if (cancelling.value) {
    return
  }
  cancelling.value = true
  phase.value = 'cancelled'
  try {
    await call('cancel')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '同步取消状态失败'
  } finally {
    cancelling.value = false
  }
}
async function pay(confirmedForOther = false) {
  if (phase.value === 'paying' || disposed || !preview.value) {
    return
  }
  if (!preview.value.sameAccount && !confirmedForOther) {
    phase.value = 'confirm'
    return
  }
  phase.value = 'paying'
  error.value = ''
  try {
    const intent = await call<PaymentIntent>('intent', confirmedForOther ? { confirmedRecipientId: preview.value.recipient.id } : {})
    if (disposed) {
      return
    }
    if (intent.type !== 'jsapi') {
      throw new Error('此链接暂不能发起微信网页支付，请返回原设备重新扫码。')
    }
    const result = await chooseWechatPay(preview.value.order.id, intent.parameters, {
      active: () => !disposed && phase.value === 'paying',
      configuration: (url) => call<WechatJsSdkConfiguration>('js-sdk', { url }),
    })
    if (disposed || preview.value.order.status === 'paid') {
      return
    }
    phase.value = result === 'cancel' ? 'cancelled' : 'pending'
    if (result === 'cancel') {
      await cancelPayment()
    }
    if (result === 'fail') {
      error.value = '微信支付未完成，请先核对订单结果后重试。'
    }
    void refreshStatus()
  } catch (cause) {
    if (!disposed) {
      phase.value = !identity.user || (cause instanceof RequestError && cause.code === 'CHECKOUT_WECHAT_AUTH_REQUIRED') ? 'login' : 'error'
      error.value = cause instanceof Error ? cause.message : '发起支付失败'
    }
  }
}
async function inspect() {
  if (inspecting || disposed) {
    return
  }
  inspecting = true
  phase.value = 'loading'
  error.value = ''
  try {
    preview.value = await call<WechatCheckoutPreview>('preview')
    if (disposed) {
      return
    }
    if (preview.value.order.status === 'paid') {
      phase.value = 'paid'
      return
    }
    if (preview.value.order.status !== 'pending' || Date.parse(preview.value.order.expiresAt) <= Date.now()) {
      throw new Error('订单已关闭或过期，请返回原设备核对订单。')
    }
    if (preview.value.payerUnavailable) {
      throw new Error('此订单已由另一微信账号发起支付，请返回原设备核对订单。')
    }
    watchPayment()
    if (!preview.value.sameAccount) {
      phase.value = 'confirm'
    } else {
      await pay()
    }
  } catch (cause) {
    if (!disposed) {
      phase.value = !identity.user || (cause instanceof RequestError && cause.code === 'CHECKOUT_WECHAT_AUTH_REQUIRED') ? 'login' : 'error'
      error.value = cause instanceof Error ? cause.message : '读取支付链接失败'
    }
  } finally {
    inspecting = false
  }
}
async function login() {
  if (ticket) {
    // Preserve only across the explicit OAuth redirect; the callback consumes it again.
    await startWechatCheckoutLogin(ticket)
  }
}
onMounted(async () => {
  ticket = takeCheckoutTicket()
  // Before any request, dialog or SDK call: reload/back can never repeat automatic payment.
  history.replaceState(null, '', `${location.pathname}${location.search}#/pay/wechat`)
  if (!ticket) {
    phase.value = 'consumed'
  } else if (!inWechat || !isWechatPayBrowser(navigator.userAgent, matchMedia('(pointer:coarse)').matches, navigator.maxTouchPoints)) {
    phase.value = 'outside'
  } else if (!identity.user || !takeCheckoutAuthentication(ticket)) {
    phase.value = 'login'
    await startWechatCheckoutLogin(ticket)
  } else {
    await inspect()
  }
})
onBeforeUnmount(() => {
  disposed = true
  stopUpdates?.()
})
</script>

<template>
  <section class="payment-handoff-page">
    <ApplicationHeader
      title="微信支付"
      back-label="T方舟"
      @back="navigateTab('home')"
    />
    <div class="payment-handoff-card">
      <AppIcon :name="phase === 'paid' ? 'check' : 'wallet'" :size="28" />
      <h1>{{ phase === 'paid' ? '资源包已到账' : phase === 'consumed' ? '支付链接已处理' : phase === 'cancelled' ? '已取消支付' : '确认资源包支付' }}</h1>
      <template v-if="preview">
        <div class="payment-recipient"><UserAvatar :src="preview.recipient.avatarUrl" :size="40" /><span>充值账号<strong>{{ preview.recipient.nickname }}</strong><small>账号尾号 {{ preview.recipient.id.slice(-6) }}</small></span></div>
        <p class="payment-handoff-product">{{ preview.order.packageName }}</p>
        <strong class="payment-handoff-amount">¥{{ displayMoney(preview.order.amount) }}</strong>
        <p>{{ preview.order.quota }} 额度，另赠 {{ preview.order.bonusQuota }} 额度</p>
      </template>
      <p v-if="phase === 'loading' || phase === 'paying'" role="status">{{ phase === 'paying' ? '正在打开微信支付…' : '正在核对登录账号与订单…' }}</p>
      <p v-else-if="phase === 'paid'">服务端已确认付款，额度已发放给 {{ preview?.recipient.nickname }}。</p>
      <p v-else-if="phase === 'pending'" role="status">正在核对付款结果，完成后本页和原设备会自动更新。</p>
      <p v-else-if="phase === 'consumed'">为避免重复调起，刷新后不会自动支付。如需继续，请在原设备重新扫码。</p>
      <p v-else-if="phase === 'outside'">请使用微信扫一扫打开此支付链接，电脑端无法直接调起微信网页支付。</p>
      <p v-else-if="phase === 'cancelled'">本次不会再次自动发起支付，你可以在下方重新核对账号后继续。</p>
      <p
        v-if="error"
        class="form-error"
        role="alert"
      >{{ error }}</p>
      <button
        v-if="phase === 'login'"
        class="button button-primary"
        @click="login"
      >微信登录并核对账号</button>
      <button
        v-if="phase === 'error' || phase === 'cancelled'"
        class="button button-primary"
        :disabled="cancelling"
        @click="inspect"
      >重新核对账号并支付</button>
      <button
        v-if="phase === 'pending'"
        class="button button-secondary"
        @click="refreshStatus()"
      >核对支付结果</button>
      <button
        v-if="!['paying', 'loading', 'confirm'].includes(phase)"
        class="text-button"
        @click="navigateTab('home')"
      >返回 T方舟</button>
    </div>
    <Modal
      :open="phase === 'confirm'"
      title="账号不一致"
      @close="cancelPayment"
    >
      <p>当前登录账号与下单账号不一致，是否为下面的用户付款？</p>
      <p class="payment-current-account">当前账号：{{ identity.user?.nickname }} · 尾号 {{ identity.user?.id.slice(-6) }}</p>
      <div v-if="preview" class="payment-recipient"><UserAvatar :src="preview.recipient.avatarUrl" :size="48" /><div><strong>{{ preview.recipient.nickname }}</strong><small>充值账号尾号 {{ preview.recipient.id.slice(-6) }}</small></div></div>
      <p v-if="preview">{{ preview.order.packageName }} · ¥{{ displayMoney(preview.order.amount) }}</p>
      <p class="payment-handoff-warning">确认后将为 {{ preview?.recipient.nickname }} 购买资源包，额度会发放到对方账号，不会进入你当前的账号。</p>
      <template #footer>
        <button class="button button-secondary" @click="cancelPayment">取消</button>
        <button class="button button-primary" @click="pay(true)">为 {{ preview?.recipient.nickname }} 付款</button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.payment-handoff-page {
  max-width: 620px;
  margin: 0 auto;
  padding: 24px 0;
}
.payment-handoff-card {
  display: grid;
  justify-items: center;
  gap: 16px;
  margin-top: 24px;
  padding: 36px 24px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  text-align: center;
}
.payment-handoff-card > svg {
  color: var(--accent);
}
.payment-handoff-card h1 {
  margin: 0;
  font-size: 23px;
  font-weight: 600;
}
.payment-handoff-card p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.8;
}
.payment-handoff-card p.form-error {
  color: #a94633;
}
.payment-handoff-amount {
  font-size: 36px;
  font-weight: 600;
}
.payment-recipient {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
}
.payment-recipient span {
  font-size: 12px;
  color: var(--muted);
  text-align: left;
}
.payment-recipient strong {
  display: block;
  color: var(--ink);
  font-size: 16px;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.payment-handoff-warning {
  font-size: 13px;
  color: #8a6841;
  line-height: 1.9;
}
@media (max-width: 767px) {
  .payment-handoff-page {
    padding-top: 8px;
  }
  .payment-handoff-card {
    margin-top: 12px;
    padding: 28px 18px;
  }
}
</style>
