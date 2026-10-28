<script setup lang="ts">
import type { PaymentOrder, WechatCheckoutStage } from '@t-box/shared'
import { Modal, UserAvatar } from '@t-box/ui-kit'
import { ref, watch } from 'vue'
import { identity } from '../../core/session'
import { displayMoney as fee } from './format'
import './wallet.css'

const props = defineProps<{
  open: boolean
  order: PaymentOrder | null
  qr: string
  link: string
  stage: WechatCheckoutStage
  notice: string
  error: string
  unavailable: boolean
  cancelling: boolean
}>()
defineEmits<{ close: [], cancelOrder: [] }>()
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
    :open="open"
    :title="unavailable ? '订单状态' : '微信支付'"
    @close="$emit('close')"
  >
    <div class="wallet-checkout">
      <div v-if="qr && identity.user" class="checkout-account"><UserAvatar :src="identity.user.avatarUrl" :size="36" /><span>充值给 {{ identity.user.nickname }}<small>账号尾号 {{ identity.user.id.slice(-6) }}</small></span></div>
      <span class="wallet-checkout-label">{{
        order?.packageName ?? '资源包'
      }}</span>
      <strong v-if="order">¥{{ fee(order.amount) }}</strong>
      <small v-if="order">{{ order.quota }} 额度，另赠 {{ order.bonusQuota }} 额度 ·
        {{ order.validDays }} 天有效</small>
      <div v-if="qr" class="qr-image-frame">
        <img
          :src="qr"
          alt="微信支付二维码，请使用微信扫一扫"
          width="280"
          height="280"
        >
        <div
          v-if="stage !== 'waiting'"
          class="qr-status-cover"
          role="status"
        >
          <strong>{{ stage === 'paid' ? '支付成功' : stage === 'closed' ? '订单已关闭' : stage === 'expired' ? '二维码已过期' : stage === 'cancelled' ? '手机已取消' : '已扫码' }}</strong>
          <span>{{ notice }}</span>
        </div>
      </div>
      <p v-if="!qr || stage === 'waiting'" role="status">
        {{ notice }}
      </p>
      <div v-if="link && stage === 'waiting'" class="checkout-link-actions">
        <button
          type="button"
          class="button button-secondary"
          @click="copyLink"
        >{{ copied ? '支付链接已复制' : '复制支付链接' }}</button>
        <small>在同一部手机付款？复制链接到微信聊天中打开。</small>
        <label v-if="copyError" class="checkout-manual-link">请长按复制链接<input
          :value="link"
          readonly
          aria-label="支付链接"
          @focus="($event.target as HTMLInputElement).select()"
        ></label>
      </div>
      <p
        v-if="error"
        class="wallet-error"
        role="alert"
      >
        {{ error }}
      </p>
      <small>到账以服务端核对结果为准</small>
      <button
        v-if="order?.status === 'pending'"
        class="text-button"
        :disabled="cancelling"
        @click="$emit('cancelOrder')"
      >{{ cancelling ? '正在核对并取消…' : '核对并取消订单' }}</button>
    </div>
  </Modal>
</template>
