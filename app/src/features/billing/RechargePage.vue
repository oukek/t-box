<script setup lang="ts">
import type {
  PaymentCapabilities,
  PaymentOrder,
  ResourcePackage,
} from '@t-box/shared'
import { WechatPay } from '@t-box/capacitor-wechat-pay'
import { AppIcon } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { openWallet } from '../../core/navigation'
import { request, RequestError } from '../../core/network'
import CheckoutDialog from './CheckoutDialog.vue'
import { displayMoney as fee } from './format'
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
// Freeze selection on an unknown network outcome; retry the same idempotent order.
const attempted = ref<{ packageId: string, version: number } | null>(null)
const checkout = useWechatCheckout(async () => {
  pendingOrder.value = checkout.order.value
})
watch(checkout.order, (order) => {
  if (order && pendingOrder.value?.id === order.id) {
    pendingOrder.value = order
  }
})
const product = computed(() =>
  products.value.find((p) => p.id === selected.value),
)
const locked = computed(
  () => busy.value || !!attempted.value || !!pendingOrder.value,
)
const payable = computed(
  () =>
    !pendingOrder.value ||
    (pendingOrder.value.status === 'pending' &&
      Date.parse(pendingOrder.value.expiresAt) > Date.now()),
)
let key = crypto.randomUUID()
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  loading.value = true
  error.value = ''
  enabled.value = false
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
    if (!products.value.some((p) => p.id === selected.value)) {
      selected.value = products.value[0]?.id ?? ''
    }
    enabled.value =
      !unavailable &&
      caps.data.enabled &&
      (!caps.data.modes || caps.data.modes.includes(paymentMode()))
    if (paymentMode() === 'app' && !unavailable) {
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
  if (busy.value || pendingOrder.value?.status === 'pending') {
    return
  }
  pendingOrder.value = null
  attempted.value = null
  key = crypto.randomUUID()
  void load()
}
onMounted(async () => {
  await load()
  if (controller?.signal.aborted) {
    return
  }
  await checkout.resume()
  if (!controller?.signal.aborted && checkout.order.value) {
    pendingOrder.value = checkout.order.value
  }
})
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="billing-detail-page">
    <ApplicationHeader
      title="购买资源包"
      back-label="额度"
      @back="openWallet"
    >
      <template #actions><button
        class="wallet-refresh"
        aria-label="刷新资源包"
        :disabled="loading || locked"
        @click="load"
      >
        <AppIcon name="refresh" :size="19" /></button></template>
    </ApplicationHeader>
    <p class="billing-page-intro">
      会话与图片共用额度，每个资源包独立计算有效期。
    </p>
    <p
      v-if="error"
      class="wallet-error"
      role="alert"
    >
      {{ error
      }}<button
        v-if="!locked"
        class="billing-text-button"
        @click="load"
      >
        重新加载
      </button>
    </p>
    <div v-if="loading" class="wallet-empty">正在读取资源包…</div>
    <form
      v-else
      class="recharge-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="locked">
        <legend>选择资源包</legend>
        <div class="recharge-presets resource-pack-grid">
          <button
            v-for="p in products"
            :key="p.id"
            type="button"
            :class="{ selected: selected === p.id }"
            :aria-pressed="selected === p.id"
            @click="selected = p.id"
          >
            <span>{{ p.name }}</span><strong>{{ p.quota }}<small> 额度</small></strong>
            <span v-if="p.bonusQuota !== '0'">另赠 {{ p.bonusQuota }} 额度</span>
            <span>{{ p.validDays }} 天有效 · ¥{{ p.price }}</span>
            <AppIcon
              v-if="selected === p.id"
              name="check"
              :size="13"
            />
          </button>
        </div>
      </fieldset>
      <p v-if="!products.length" class="recharge-hint">
        暂无上架资源包，请稍后再试。
      </p>
      <div v-if="pendingOrder || product" class="recharge-summary">
        <div>
          <span>{{ pendingOrder?.packageName ?? product?.name }}</span><strong>¥{{ fee(pendingOrder?.amount ?? product?.price ?? '0') }}</strong>
        </div>
        <div>
          <span>额度 / 赠送</span><strong>{{ pendingOrder?.quota ?? product?.quota }} /
            {{ pendingOrder?.bonusQuota ?? product?.bonusQuota }}</strong>
        </div>
        <p class="recharge-hint">
          支付成功起
          {{ pendingOrder?.validDays ?? product?.validDays }}
          天有效，优先使用最早到期的额度。
        </p>
        <p v-if="!pendingOrder && product?.description" class="recharge-hint">
          {{ product.description }}
        </p>
      </div>
      <p v-if="pendingOrder" class="recharge-hint">
        订单权益已固定。{{
          pendingOrder.status === 'paid'
            ? '已到账。'
            : !payable
              ? '订单已关闭或过期。'
              : '可继续支付原订单。'
        }}
      </p>
      <p
        v-if="unavailable || !enabled"
        id="purchase-unavailable"
        class="recharge-unavailable"
        role="status"
      >
        <AppIcon name="info" :size="16" />{{ reason }}
      </p>
      <button
        class="button button-primary recharge-submit"
        :disabled="busy || !enabled || !payable || (!product && !pendingOrder)"
        :aria-describedby="!enabled ? 'purchase-unavailable' : undefined"
      >
        {{
          busy
            ? '正在发起…'
            : pendingOrder?.status === 'paid'
              ? '已到账'
              : !payable
                ? '订单不可支付'
                : attempted || pendingOrder
                  ? '继续支付原订单'
                  : '微信支付'
        }}
      </button>
      <button
        v-if="pendingOrder && pendingOrder.status !== 'pending'"
        type="button"
        class="billing-text-button"
        @click="newOrder"
      >
        购买其他资源包
      </button>
      <p class="recharge-hint">
        支付结果由服务端确认。额度不等同于人民币，不支持提现。
      </p>
    </form>
    <CheckoutDialog
      :open="checkout.open.value"
      :order="checkout.order.value"
      :qr="checkout.qr.value"
      :stage="checkout.stage.value"
      :cancelling="checkout.cancelling.value"
      :notice="checkout.notice.value"
      :error="checkout.error.value"
      :unavailable="!!unavailable"
      @close="checkout.close"
      @cancel-order="checkout.cancelOrder"
    />
  </section>
</template>
