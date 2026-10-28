<script setup lang="ts">
import type { AppUser, PaymentOrder } from '@t-box/shared'
import type { CheckoutPhase } from './wechatCheckout'
import { AppIcon, Modal, UserAvatar } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'
import { identity } from '../../core/session'
import { displayMoney as fee } from './format'
import { paymentCountdown, usePaymentClock } from './paymentClock'
import './wallet.css'

const props = withDefaults(defineProps<{
  open: boolean
  order: PaymentOrder | null
  qr?: string
  link?: string
  phase: CheckoutPhase
  expiresAt?: string
  details?: boolean
  notice?: string
  error?: string
  unavailable?: boolean
  cancelling?: boolean
  checking?: boolean
  canCloseOrder?: boolean
  recipient?: Pick<AppUser, 'id' | 'nickname' | 'avatarUrl'>
}>(), { qr: '', link: '', expiresAt: '', details: false, notice: '', error: '', unavailable: false, cancelling: false, checking: false, canCloseOrder: true })
defineEmits<{ close: [], cancelOrder: [], refresh: [], continue: [] }>()
const now = usePaymentClock()
const deadline = computed(() => props.expiresAt || props.order?.expiresAt || '')
const phase = computed<CheckoutPhase>(() => props.order?.status === 'paid' ? 'paid' : props.order?.status === 'closed' ? 'closed' : deadline.value && Date.parse(deadline.value) <= now.value ? 'expired' : props.phase)
const title = computed(() => phase.value === 'paid' ? '支付成功' : phase.value === 'closed' ? '订单已关闭' : props.details ? '订单详情' : '微信支付')
const labels: Record<CheckoutPhase, [string, string]> = {
  preparing: ['正在准备支付', '即将打开微信，请稍候。'],
  waiting: ['等待支付', '请完成微信支付，结果将在这里自动更新。'],
  scanned: ['已扫码', '请在手机上核对充值账号。'],
  confirming: ['等待手机确认', '请在微信网页中确认充值账号。'],
  paying: ['支付中', '请在微信中完成支付，无需重复提交。'],
  verifying: ['正在确认到账', '已收到微信返回结果，正在等待服务端确认。'],
  cancelled: ['本次支付未完成', '订单仍保留，你可以核对支付结果或关闭订单。'],
  expired: ['支付时间已到', '若已经付款，请核对支付结果；否则可关闭后重新购买。'],
  closed: ['订单已关闭', '这笔订单不会再发起支付，可以重新选择资源包。'],
  paid: ['资源包已到账', '服务端已确认付款，可继续使用 AI 服务。'],
}
const statusLabel = computed(() => props.details && ['scanned', 'confirming', 'paying'].includes(phase.value) ? ['订单待支付', '手机支付流程尚未完成，请在已扫码的手机上继续，或核对支付结果。'] : labels[phase.value])
const spinning = computed(() => !props.details && ['preparing', 'paying', 'verifying'].includes(phase.value))
const recipient = computed(() => props.recipient || identity.user)
const copied = ref(false)
const copyError = ref(false)
watch(() => props.link, () => {
  copied.value = false
  copyError.value = false
})
async function copyLink() {
  try {
    await navigator.clipboard.writeText(props.link)
    copied.value = true
    copyError.value = false
  } catch {
    copyError.value = true
  }
}
</script>

<template>
  <Modal
    class="checkout-dialog"
    :open="open"
    :title="title"
    @close="$emit('close')"
  >
    <div class="checkout-receipt" :class="{ 'checkout-receipt--paid': phase === 'paid' }">
      <div
        v-if="!qr || ['paid', 'closed', 'expired'].includes(phase)"
        class="checkout-state-mark"
        :class="{ spinning, success: phase === 'paid' }"
      ><AppIcon
        v-if="!spinning"
        :name="phase === 'paid' ? 'check' : phase === 'closed' ? 'close' : 'clock'"
        :size="29"
      /></div>
      <h3>{{ statusLabel[0] }}</h3>
      <p class="checkout-status-description" role="status">{{ notice || statusLabel[1] }}</p>
      <div v-if="qr && !['paid', 'closed', 'expired'].includes(phase)" class="qr-image-frame checkout-qr">
        <img
          :src="qr"
          alt="微信支付二维码，请使用微信扫一扫"
          width="248"
          height="248"
        >
        <div
          v-if="phase !== 'waiting'"
          class="qr-status-cover"
          role="status"
        ><AppIcon name="check" :size="28" /><strong>{{ phase === 'cancelled' ? '本次支付未完成' : phase === 'verifying' ? '正在确认到账' : '已扫码' }}</strong><span>{{ statusLabel[1] }}</span></div>
      </div>
      <div class="checkout-order-summary">
        <div><span>{{ order?.packageName || '资源包' }}</span><strong v-if="order">¥{{ fee(order.amount) }}</strong></div>
        <p v-if="order">{{ order.quota }} 额度<template v-if="Number(order.bonusQuota)"> + {{ order.bonusQuota }} 赠送</template><span>{{ order.validDays }} 天有效</span></p>
        <div v-if="recipient" class="checkout-recipient"><UserAvatar :src="recipient.avatarUrl" :size="28" /><span>充值给 {{ recipient.nickname }}<small>账号尾号 {{ recipient.id.slice(-6) }}</small></span></div>
      </div>
      <div v-if="order?.status === 'pending' && deadline" class="checkout-deadline"><span>{{ phase === 'expired' ? '有效时间已结束' : qr ? '二维码剩余时间' : '订单剩余支付时间' }}</span><time>{{ paymentCountdown(deadline, now) }}</time></div>
      <div v-if="link && phase === 'waiting'" class="checkout-link-actions"><button class="billing-text-button" @click="copyLink"><AppIcon name="copy" :size="14" />{{ copied ? '支付链接已复制' : '在本机付款？复制链接到微信打开' }}</button><label v-if="copyError" class="checkout-manual-link">请长按复制链接<input
        :value="link"
        readonly
        aria-label="支付链接"
        @focus="($event.target as HTMLInputElement).select()"
      ></label></div>
      <p
        v-if="error"
        class="wallet-error"
        role="alert"
      >{{ error }}</p>
      <small v-if="order" class="checkout-order-reference">订单尾号 {{ order.id.slice(-8) }} · 支付结果由服务端确认</small>
    </div>
    <template #footer>
      <template v-if="order?.status === 'pending'">
        <button
          class="button button-secondary"
          :disabled="checking || cancelling"
          @click="$emit('refresh')"
        >{{ checking ? '正在核对…' : '核对支付结果' }}</button>
        <button
          v-if="canCloseOrder"
          class="button checkout-close-order"
          :disabled="checking || cancelling"
          @click="$emit('cancelOrder')"
        >{{ cancelling ? '正在关闭…' : '关闭订单' }}</button>
        <button
          v-if="details && phase === 'waiting' && !unavailable"
          class="button button-primary checkout-continue"
          :disabled="checking || cancelling"
          @click="$emit('continue')"
        >继续微信支付</button>
      </template>
      <button
        v-else
        class="button button-primary checkout-complete"
        @click="$emit('close')"
      >{{ phase === 'paid' ? '完成' : '返回选择资源包' }}</button>
    </template>
  </Modal>
</template>
