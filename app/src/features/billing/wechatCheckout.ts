import type { PluginListenerHandle } from '@capacitor/core'
import type {
  PaymentIntent,
  PaymentOrder,
  WechatCheckoutLink,
  WechatCheckoutStage,
  WechatCheckoutState,
  WechatPaymentMode,
} from '@t-box/shared'
import { Capacitor } from '@capacitor/core'
import { WechatPay } from '@t-box/capacitor-wechat-pay'
import QRCode from 'qrcode'
import { onBeforeUnmount, ref } from 'vue'
import { request } from '../../core/network'
import { watchQrState } from '../../core/qrSocket'
import { identity } from '../../core/session'
import { ErrorCode } from '../../error-codes.js'
import {
  billingPurchaseBlockReason,
  selectPaymentMode,
  usesWechatCheckoutLink,
} from './paymentEnvironment'
import {
  forgetCheckout,
  pendingCheckout,
  rememberCheckout,
} from './pendingCheckout'
import { chooseWechatPay } from './wechatJsSdk'

export function paymentMode(): WechatPaymentMode {
  return selectPaymentMode(
    Capacitor.isNativePlatform(),
    navigator.userAgent,
    matchMedia('(pointer:coarse)').matches,
  )
}
export function purchaseBlockReason(): string | null {
  return billingPurchaseBlockReason(
    Capacitor.isNativePlatform(),
    Capacitor.getPlatform(),
  )
}
export function useWechatCheckout(onPaid: () => Promise<void>) {
  const order = ref<PaymentOrder | null>(null)
  const qr = ref('')
  const stage = ref<WechatCheckoutStage>('waiting')
  const notice = ref('')
  const error = ref('')
  const open = ref(false)
  const cancelling = ref(false)
  let stopUpdates: (() => void) | undefined
  let generation = 0
  let disposed = false
  const listeners: PluginListenerHandle[] = []
  let nativeListeners: Promise<void> | undefined
  let clientHint = ''
  async function listenNative() {
    nativeListeners ??= (async () => {
      for (const event of ['paymentResult', 'foreground'] as const) {
        const refresh = (result?: { code: number }) => {
          if (result) {
            clientHint =
              result.code === -2
                ? '已取消支付，可在原订单中继续'
                : result.code === 0
                  ? '正在核对到账结果…'
                  : '支付未完成，请核对原订单后重试'
            notice.value = clientHint
          }
          // SDK callbacks are hints; only the authenticated server can prove payment.
          if (!disposed && open.value && order.value?.status === 'pending') {
            void checkOrder(order.value.id, generation)
          }
        }
        const handle =
          event === 'paymentResult'
            ? await WechatPay.addListener('paymentResult', refresh)
            : await WechatPay.addListener('foreground', refresh)
        if (disposed) {
          await handle.remove()
        } else {
          listeners.push(handle)
        }
      }
    })()
    return nativeListeners
  }
  function close() {
    generation++
    stopUpdates?.()
    stopUpdates = undefined
    open.value = false
    qr.value = ''
  }
  let paidHandled = false
  function acceptState(value: WechatCheckoutState, version: number) {
    if (version !== generation || disposed) {
      return
    }
    order.value = value.order
    stage.value = value.stage
    error.value = ''
    const notices: Record<WechatCheckoutStage, string> = {
      waiting: '请用微信扫一扫，核对充值账号后完成支付',
      scanned: '已扫码，正在核对手机上的微信身份',
      confirming: '已扫码，等待手机确认充值账号',
      paying: '已扫码，等待手机完成微信支付',
      cancelled: '手机已取消，请在原手机重试；更换手机前请先核对并取消订单',
      expired: '二维码已过期，请核对订单后重新获取',
      closed: '订单已关闭',
      paid: '资源包已到账',
    }
    notice.value = notices[value.stage]
    if (value.order.status === 'paid') {
      forgetCheckout()
      stopUpdates?.()
      stopUpdates = undefined
      if (!paidHandled) {
        paidHandled = true
        void onPaid().catch(() => {
          error.value = '已付款，余额刷新失败，请重新打开账户查看'
        })
      }
    }
  }
  function watchOrder(id: string, version: number) {
    stopUpdates?.()
    stopUpdates = watchQrState({ type: 'payment', orderId: id, token: identity.token }, (event) => {
      if (event.type === 'payment.state') {
        acceptState(event.data, version)
      }
    }, (message) => {
      if (version === generation && !disposed) {
        error.value = message
      }
    })
  }
  async function checkOrder(id: string, version: number) {
    try {
      const { data } = await request<{ data: PaymentOrder }>(`/payments/orders/${id}/refresh`, { method: 'POST' })
      acceptState({ order: data, stage: data.status === 'pending' ? stage.value : data.status }, version)
    } catch (cause) {
      if (version === generation && !disposed) {
        error.value = cause instanceof Error ? cause.message : '核对订单失败'
      }
    }
  }
  async function cancelOrder() {
    if (!order.value || cancelling.value) {
      return
    }
    cancelling.value = true
    const version = generation
    try {
      const { data: checked } = await request<{ data: PaymentOrder }>(`/payments/orders/${order.value.id}/refresh`, { method: 'POST' })
      if (disposed || version !== generation) {
        return
      }
      if (checked.status === 'paid') {
        acceptState({ order: checked, stage: 'paid' }, version)
        return
      }
      const { data } = await request<{ data: PaymentOrder }>(`/payments/orders/${checked.id}`, { method: 'DELETE' })
      if (data) {
        acceptState({ order: data, stage: data.status === 'paid' ? 'paid' : 'closed' }, version)
      }
      forgetCheckout()
    } catch (cause) {
      if (version === generation && !disposed) {
        error.value = cause instanceof Error ? cause.message : '取消订单失败，请先核对支付结果'
      }
    } finally {
      cancelling.value = false
    }
  }
  async function startPayment(item: PaymentOrder) {
    const blocked = purchaseBlockReason()
    if (blocked) {
      throw ErrorCode.INTERNAL_PAYMENT_PLATFORM_UNAVAILABLE(blocked)
    }
    close()
    const version = generation
    error.value = ''
    stage.value = 'waiting'
    paidHandled = false
    clientHint = ''
    notice.value = '正在准备支付…'
    order.value = item
    if (usesWechatCheckoutLink(Capacitor.isNativePlatform(), navigator.userAgent, matchMedia('(pointer:coarse)').matches, navigator.maxTouchPoints)) {
      open.value = true
      watchOrder(item.id, version)
      const { data: link } = await request<{ data: WechatCheckoutLink }>(`/payments/orders/${item.id}/handoff`, { method: 'POST', body: '{}' })
      if (disposed || version !== generation) {
        return
      }
      qr.value = await QRCode.toDataURL(link.url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      if (disposed || version !== generation) {
        return
      }
      rememberCheckout(item.id)
      open.value = true
      clientHint = '请用微信扫码，核对充值账号后完成支付'
      notice.value = clientHint
      return
    }
    if (paymentMode() === 'app') {
      const status = await WechatPay.getStatus()
      if (!status.configured) {
        throw ErrorCode.INTERNAL_NATIVE_WECHAT_UNAVAILABLE()
      }
      if (!status.installed) {
        throw ErrorCode.INTERNAL_WECHAT_NOT_INSTALLED()
      }
      await listenNative()
    }
    const { data: intent } = await request<{ data: PaymentIntent }>(
      `/payments/orders/${item.id}/intent`,
      {
        method: 'POST',
        body: JSON.stringify({ mode: paymentMode() }),
      },
    )
    if (disposed || version !== generation) {
      return
    }
    rememberCheckout(item.id)
    if (intent.type === 'redirect') {
      const url = new URL(intent.url)
      if (
        url.protocol !== 'https:' ||
        !['wx.tenpay.com', 'open.weixin.qq.com'].includes(url.hostname)
      ) {
        throw ErrorCode.INTERNAL_INVALID_WECHAT_PAYMENT_URL()
      }
      location.assign(url.href)
      return
    }
    open.value = true
    watchOrder(item.id, version)
    if (intent.type === 'qr') {
      qr.value = await QRCode.toDataURL(intent.codeUrl, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      if (disposed || version !== generation) {
        qr.value = ''
        return
      }
    } else if (intent.type === 'jsapi') {
      const result = await chooseWechatPay(item.id, intent.parameters, { active: () => !disposed && version === generation })
      if (version !== generation || disposed) {
        return
      }
      notice.value = result === 'cancel'
        ? '已取消支付，可在原订单中继续'
        : result === 'ok'
          ? '正在核对到账结果…'
          : '支付未完成，可重新发起'
    } else if (intent.type === 'app' && paymentMode() === 'app') {
      notice.value = '正在调起微信，完成后将核对到账结果…'
      const result = await WechatPay.pay(intent.parameters)
      if (!result.launched) {
        throw ErrorCode.INTERNAL_WECHAT_LAUNCH_FAILED()
      }
      if (disposed || version !== generation) {
        return
      }
    } else {
      throw ErrorCode.INTERNAL_PAYMENT_METHOD_UNSUPPORTED()
    }
    void checkOrder(item.id, version)
  }
  async function pay(item: PaymentOrder) {
    try {
      await startPayment(item)
    } catch (e) {
      if (!disposed) {
        error.value = e instanceof Error ? e.message : '发起支付失败'
        notice.value = purchaseBlockReason() || '可在购买订单中核对或继续支付'
      }
      if (open.value && order.value?.status === 'pending') {
        watchOrder(order.value.id, generation)
      }
      throw e
    }
  }
  async function resume() {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
    const id = q.get('paymentOrder') || pendingCheckout()
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
      return
    }
    const authorized = q.get('wechatAuthorized') === '1'
    if (q.has('paymentOrder')) {
      history.replaceState(null, '', '#/ai/recharge')
    }
    try {
      if (paymentMode() === 'app' && !purchaseBlockReason()) {
        await listenNative()
      }
      const { data: item } = await request<{ data: PaymentOrder }>(
        `/payments/orders/${id}`,
      )
      if (disposed) {
        return
      }
      if (
        authorized &&
        !purchaseBlockReason() &&
        item.status === 'pending' &&
        Date.parse(item.expiresAt) > Date.now()
      ) {
        await pay(item)
      } else {
        order.value = item
        open.value = true
        watchOrder(id, generation)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '读取支付订单失败'
    }
  }
  onBeforeUnmount(() => {
    disposed = true
    close()
    for (const listener of listeners) {
      void listener.remove()
    }
  })
  return { open, order, qr, stage, notice, error, cancelling, cancelOrder, pay, resume, close }
}
