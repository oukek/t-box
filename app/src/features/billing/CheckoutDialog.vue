<script setup lang="ts">
import type { PaymentOrder } from '@t-box/shared'
import { Modal } from '@t-box/ui-kit'
import { displayMoney as fee } from './format'
import './wallet.css'

defineProps<{
  open: boolean
  order: PaymentOrder | null
  qr: string
  notice: string
  error: string
  unavailable: boolean
}>()
defineEmits<{ close: [] }>()
</script>

<template>
  <Modal
    :open="open"
    :title="unavailable ? '订单状态' : '微信支付'"
    @close="$emit('close')"
  >
    <div class="wallet-checkout">
      <span class="wallet-checkout-label">{{
        order?.packageName ?? '资源包'
      }}</span>
      <strong v-if="order">¥{{ fee(order.amount) }}</strong>
      <small v-if="order">{{ order.quota }} 额度，另赠 {{ order.bonusQuota }} 额度 ·
        {{ order.validDays }} 天有效</small>
      <img
        v-if="qr"
        :src="qr"
        alt="微信支付二维码，请使用微信扫一扫"
        width="280"
        height="280"
      >
      <p v-if="qr">使用微信扫一扫完成支付</p>
      <p role="status">
        {{ notice }}
      </p>
      <p
        v-if="error"
        class="wallet-error"
        role="alert"
      >
        {{ error }}
      </p>
      <small>到账以服务端核对结果为准</small>
    </div>
  </Modal>
</template>
