<script setup lang="ts">
import type {
  PaymentCapabilities,
  PaymentOrder,
  ResourcePackage,
  WechatPaymentMode,
} from '@t-box/shared'
import { WechatPay } from '@t-box/capacitor-wechat-pay'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { openWallet } from '../../core/navigation'
import { request, RequestError } from '../../core/network'
import CheckoutDialog from './CheckoutDialog.vue'
import { displayMoney as fee } from './format'
import { usePaymentClock } from './paymentClock'
import {
  paymentMode,
  purchaseBlockReason,
  useWechatCheckout,
} from './wechatCheckout'
import './recharge.css'

const unavailable = purchaseBlockReason()
const products = ref<ResourcePackage[]>([])
const selected = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const enabled = ref(false)
const reason = ref(unavailable || '当前支付方式暂未开放。')
const pendingOrder = ref<PaymentOrder | null>(null)
const availableModes = ref<WechatPaymentMode[]>()
const now = usePaymentClock()
// Freeze selection on an unknown network outcome; retry the same idempotent order.
const attempted = ref<{ packageId: string, version: number } | null>(null)
let key = crypto.randomUUID()
const checkout = useWechatCheckout(async () => {
  pendingOrder.value = null
  attempted.value = null
  key = crypto.randomUUID()
}, () => availableModes.value)
watch(checkout.order, (order) => {
  if (order && pendingOrder.value?.id === order.id) {
    pendingOrder.value = order
  }
})
const product = computed(() =>
  products.value.find((p) => p.id === selected.value),
)
const locked = computed(
  () => busy.value || !!attempted.value || (pendingOrder.value?.status === 'pending' && Date.parse(pendingOrder.value.expiresAt) > now.value),
)
const payable = computed(
  () =>
    !pendingOrder.value ||
    (pendingOrder.value.status === 'pending' &&
      Date.parse(pendingOrder.value.expiresAt) > now.value),
)
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  loading.value = true
  error.value = ''
  enabled.value = false
  reason.value = unavailable || ''
  try {
    const [options, caps] = await Promise.all([
      request<{ data: ResourcePackage[] }>('/wallet/packages', { signal }),
      request<{ data: PaymentCapabilities }>('/payments/capabilities', {
        signal,
      }),
    ])
    if (signal.aborted) {
      return
    }
    products.value = options.data
    availableModes.value = caps.data.modes
    if (!products.value.some((p) => p.id === selected.value)) {
      selected.value = products.value[0]?.id ?? ''
    }
    enabled.value =
      !unavailable &&
      caps.data.enabled &&
      (!caps.data.modes || caps.data.modes.includes(paymentMode(availableModes.value)))
    if (!unavailable && !caps.data.enabled) {
      reason.value = '在线购买尚未开放，请稍后再试。'
    } else if (!unavailable && !enabled.value) {
      reason.value = paymentMode(availableModes.value) === 'h5' ? '当前浏览器的支付方式尚未开放，请在微信中打开后购买。' : '当前支付方式尚未开放，请稍后再试。'
    }
    if (paymentMode(availableModes.value) === 'app' && !unavailable) {
      const status = await WechatPay.getStatus()
      if (signal.aborted) {
        return
      }
      enabled.value &&=
        status.configured &&
        status.installed &&
        status.appId === caps.data.mobileAppId
      if (!enabled.value) {
        reason.value = '请检查微信安装状态及当前 App 的支付配置。'
      }
    }
  } catch (cause) {
    if (!signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '读取资源包失败'
    }
  } finally {
    if (!signal.aborted) {
      loading.value = false
    }
  }
}
async function submit() {
  if (loading.value || busy.value) {
    return
  }
  if (pendingOrder.value) {
    checkout.view(pendingOrder.value)
    return
  }
  if (
    purchaseBlockReason() ||
    !enabled.value ||
    loading.value ||
    busy.value ||
    !payable.value ||
    (!product.value && !pendingOrder.value)
  ) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (!pendingOrder.value) {
      attempted.value ??= {
        packageId: product.value!.id,
        version: product.value!.version,
      }
      pendingOrder.value = (
        await request<{ data: PaymentOrder }>('/payments/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify(attempted.value),
        })
      ).data
    }
    busy.value = false
    await checkout.pay(pendingOrder.value)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '发起支付失败'
    if (
      !pendingOrder.value &&
      cause instanceof RequestError &&
      cause.code === 'PACKAGE_NOT_AVAILABLE'
    ) {
      attempted.value = null
      key = crypto.randomUUID()
      await load()
    }
    error.value = message
  } finally {
    busy.value = false
  }
}
function newOrder() {
  if (busy.value || (pendingOrder.value?.status === 'pending' && Date.parse(pendingOrder.value.expiresAt) > now.value)) {
    return
  }
  pendingOrder.value = null
  attempted.value = null
  key = crypto.randomUUID()
}
onMounted(async () => {
  await load()
  if (controller?.signal.aborted) {
    return
  }
  await checkout.resume()
  if (!controller?.signal.aborted && checkout.order.value) {
    pendingOrder.value = checkout.order.value
    selected.value = checkout.order.value.packageId
  }
})
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="billing-detail-page recharge-page">
    <ApplicationHeader
      title="购买资源包"
      back-label="额度"
      @back="openWallet"
    ><template #actions><button
      class="wallet-refresh"
      aria-label="刷新资源包"
      :disabled="loading || locked"
      @click="load"
    ><AppIcon name="refresh" :size="18" /></button></template></ApplicationHeader>
    <div class="billing-page-heading"><p class="billing-eyebrow">给日常，多一点空间</p><h1>选一份适合自己的额度</h1><p>会话与图片共用，按实际用量结算。每份资源包独立计算有效期。</p></div>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >{{ error }}<button
      v-if="!locked"
      class="billing-text-button"
      @click="load"
    >重新加载</button></p>
    <div v-if="loading" class="wallet-empty">正在读取资源包…</div>
    <form
      v-else
      class="recharge-form recharge-layout"
      @submit.prevent="submit"
    >
      <div class="recharge-products">
        <fieldset :disabled="locked"><legend>选择资源包<span v-if="pendingOrder?.status === 'pending'">当前订单权益已固定</span></legend>
          <div class="recharge-presets resource-pack-grid">
            <button
              v-for="p in products"
              :key="p.id"
              type="button"
              :class="{ selected: selected === p.id }"
              :aria-pressed="selected === p.id"
              @click="selected = p.id"
            >
              <span class="pack-option-name">{{ p.name }}</span><span class="pack-option-price"><small>¥</small>{{ fee(p.price) }}</span>
              <strong>{{ p.quota }}<small> 额度</small></strong><span class="pack-option-bonus">{{ Number(p.bonusQuota) ? `另赠 ${p.bonusQuota} 额度` : '按需使用，灵活安排' }}</span>
              <span class="pack-option-validity"><AppIcon name="clock" :size="13" />{{ p.validDays }} 天有效</span><span class="pack-option-check"><AppIcon
                v-if="selected === p.id"
                name="check"
                :size="12"
              /></span>
            </button>
          </div>
        </fieldset>
        <div v-if="!products.length" class="wallet-empty"><AppIcon name="wallet" :size="28" /><p>暂无在售资源包</p><small>稍后再来看看。</small></div>
        <div class="billing-purchase-notes"><h2>买之前，了解这些</h2><p><AppIcon name="check" :size="15" />会话、看图与图片生成共用额度。</p><p><AppIcon name="clock" :size="15" />付款成功开始计时，优先使用最早到期的额度。</p><p><AppIcon name="info" :size="15" />额度用于 AI 服务，不等同于人民币，不支持提现。</p></div>
      </div>
      <aside class="recharge-receipt" aria-label="所选资源包">
        <span class="billing-eyebrow">本次选择</span><h2>{{ pendingOrder?.packageName ?? product?.name ?? '请选择资源包' }}</h2>
        <dl v-if="pendingOrder || product"><div><dt>基础额度</dt><dd>{{ pendingOrder?.quota ?? product?.quota }}</dd></div><div><dt>赠送额度</dt><dd class="recharge-gift">+ {{ pendingOrder?.bonusQuota ?? product?.bonusQuota }}</dd></div><div><dt>有效期</dt><dd>{{ pendingOrder?.validDays ?? product?.validDays }} 天</dd></div></dl>
        <p v-if="product?.description && !pendingOrder" class="recharge-product-note">{{ product.description }}</p>
        <p
          v-if="unavailable || !enabled"
          id="purchase-unavailable"
          class="recharge-unavailable"
          role="status"
        ><AppIcon name="info" :size="16" />{{ reason }}<button
          v-if="!unavailable && !loading"
          type="button"
          class="billing-text-button"
          @click="load"
        >刷新状态</button></p>
        <div class="recharge-payment-dock">
          <div class="recharge-payment-total"><span>{{ pendingOrder ? '当前订单' : '实付金额' }}</span><strong>¥{{ fee(pendingOrder?.amount ?? product?.price ?? '0') }}</strong></div>
          <button
            class="button button-primary recharge-submit"
            :disabled="busy || (!pendingOrder && !enabled) || (!product && !pendingOrder)"
            :aria-describedby="!enabled ? 'purchase-unavailable' : undefined"
          ><AppIcon name="chat" :size="18" />{{ busy ? '正在创建订单…' : pendingOrder ? '查看订单' : attempted ? '恢复原订单' : '微信支付' }}</button>
        </div>
        <button
          v-if="pendingOrder && (!payable || pendingOrder.status !== 'pending')"
          type="button"
          class="billing-text-button recharge-new-order"
          @click="newOrder"
        >重新选择资源包</button>
        <p class="recharge-receipt-note"><AppIcon name="lock" :size="12" />付款结果由服务端确认后到账</p>
      </aside>
    </form>
    <CheckoutDialog
      :open="checkout.open.value"
      :order="checkout.order.value"
      :qr="checkout.qr.value"
      :link="checkout.link.value"
      :phase="checkout.phase.value"
      :expires-at="checkout.expiresAt.value"
      :details="checkout.details.value"
      :cancelling="checkout.cancelling.value"
      :checking="checkout.checking.value"
      :notice="checkout.notice.value"
      :error="checkout.error.value"
      :unavailable="!!unavailable || !enabled"
      @close="checkout.close"
      @cancel-order="checkout.cancelOrder"
      @refresh="checkout.refresh"
      @continue="checkout.order.value && checkout.pay(checkout.order.value)"
    />
  </section>
</template>
