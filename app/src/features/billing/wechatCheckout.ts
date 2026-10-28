import type { PluginListenerHandle } from '@capacitor/core'
import type { PaymentIntent, PaymentOrder, WechatCheckoutLink, WechatCheckoutStage, WechatCheckoutState, WechatPaymentMode } from '@t-box/shared'
import { Capacitor } from '@capacitor/core'
import { WechatPay } from '@t-box/capacitor-wechat-pay'
import QRCode from 'qrcode'
import { onBeforeUnmount, ref } from 'vue'
import { request } from '../../core/network'
import { watchQrState } from '../../core/qrSocket'
import { identity } from '../../core/session'
import { ErrorCode } from '../../error-codes.js'
import { billingPurchaseBlockReason, selectPaymentMode, usesWechatCheckoutLink } from './paymentEnvironment'
import { forgetCheckout, pendingCheckout, rememberCheckout } from './pendingCheckout'
import { chooseWechatPay } from './wechatJsSdk'

export type CheckoutPhase = WechatCheckoutStage | 'preparing' | 'verifying'
export function paymentMode(availableModes?: readonly WechatPaymentMode[]): WechatPaymentMode {
  return selectPaymentMode(Capacitor.isNativePlatform(), navigator.userAgent, matchMedia('(pointer:coarse)').matches, availableModes)
}
export function purchaseBlockReason(): string | null {
  return billingPurchaseBlockReason(Capacitor.isNativePlatform(), Capacitor.getPlatform())
}
export function useWechatCheckout(onPaid: () => Promise<void>, availableModes?: () => readonly WechatPaymentMode[] | undefined) {
  const currentMode = () => paymentMode(availableModes?.())
  const order = ref<PaymentOrder | null>(null)
  const qr = ref('')
  const link = ref('')
  const stage = ref<WechatCheckoutStage>('waiting')
  const phase = ref<CheckoutPhase>('waiting')
  const expiresAt = ref('')
  const details = ref(false)
  const notice = ref('')
  const error = ref('')
  const open = ref(false)
  const cancelling = ref(false)
  const checking = ref(false)
  let stopUpdates: (() => void) | undefined
  let generation = 0
  let disposed = false
  let preparing = false
  let cashierActive = false
  let paidHandled = false
  let clientResult: 'ok' | 'cancel' | 'fail' | '' = ''
  const isPaid = () => order.value?.status === 'paid'
  const listeners: PluginListenerHandle[] = []
  let nativeListeners: Promise<void> | undefined
  function close() {
    generation++
    stopUpdates?.()
    stopUpdates = undefined
    open.value = false
    checking.value = false
    qr.value = ''
    link.value = ''
  }
  function acceptState(value: WechatCheckoutState, version: number) {
    if (version !== generation || disposed) {
      return
    }
    order.value = value.order
    stage.value = value.stage
    expiresAt.value = value.expiresAt || expiresAt.value || value.order.expiresAt
    error.value = ''
    phase.value = value.order.status !== 'pending'
      ? value.order.status
      : value.stage === 'expired'
        ? 'expired'
        : preparing
          ? 'preparing'
          : clientResult === 'ok'
            ? 'verifying'
            : clientResult === 'cancel' || clientResult === 'fail'
              ? 'cancelled'
              : cashierActive ? 'paying' : value.stage
    notice.value = phase.value === 'verifying' ? '正在等待服务端确认到账，结果会自动更新。' : ''
    if (value.order.status === 'paid') {
      forgetCheckout()
      stopUpdates?.()
      stopUpdates = undefined
      if (!paidHandled) {
        paidHandled = true
        void onPaid().catch(() => {
          if (version === generation && !disposed) {
            error.value = '支付成功，额度暂未刷新，请重新打开我的额度。'
          }
        })
      }
    } else if (value.order.status === 'closed') {
      forgetCheckout()
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
    if (checking.value || version !== generation || disposed) {
      return
    }
    checking.value = true
    try {
      const { data } = await request<{ data: PaymentOrder }>(`/payments/orders/${id}/refresh`, { method: 'POST' })
      acceptState({ order: data, stage: data.status === 'pending' ? stage.value : data.status }, version)
    } catch (cause) {
      if (version === generation && !disposed) {
        error.value = cause instanceof Error ? cause.message : '核对订单失败'
      }
    } finally {
      if (version === generation) {
        checking.value = false
      }
    }
  }
  async function refresh() {
    if (order.value) {
      await checkOrder(order.value.id, generation)
    }
  }
  async function listenNative() {
    nativeListeners ??= (async () => {
      for (const event of ['paymentResult', 'foreground'] as const) {
        const refreshNative = (result?: { code: number }) => {
          if (result && order.value?.status === 'pending') {
            cashierActive = false
            clientResult = result.code === 0 ? 'ok' : result.code === -2 ? 'cancel' : 'fail'
            phase.value = clientResult === 'ok' ? 'verifying' : 'cancelled'
          }
          if (!disposed && open.value && order.value?.status === 'pending') {
            void refresh()
          }
        }
        const handle = event === 'paymentResult' ? await WechatPay.addListener('paymentResult', refreshNative) : await WechatPay.addListener('foreground', refreshNative)
        if (disposed) {
          await handle.remove()
        } else {
          listeners.push(handle)
        }
      }
    })()
    return nativeListeners
  }
  async function cancelOrder() {
    if (!order.value || cancelling.value || checking.value) {
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
    } catch (cause) {
      if (version === generation && !disposed) {
        error.value = cause instanceof Error ? cause.message : '关闭订单失败，请稍后核对支付结果'
      }
    } finally {
      if (version === generation) {
        cancelling.value = false
      }
    }
  }
  function begin(item: PaymentOrder, preparingPayment = false) {
    close()
    order.value = item
    expiresAt.value = item.expiresAt
    details.value = !preparingPayment
    stage.value = item.status === 'pending' ? 'waiting' : item.status
    phase.value = preparingPayment ? 'preparing' : stage.value
    preparing = preparingPayment
    cashierActive = false
    cancelling.value = false
    paidHandled = false
    clientResult = ''
    notice.value = ''
    error.value = ''
    open.value = true
    watchOrder(item.id, generation)
    return generation
  }
  function view(item: PaymentOrder) {
    begin(item)
  }
  async function startPayment(item: PaymentOrder, version: number) {
    const blocked = purchaseBlockReason()
    if (blocked) {
      throw ErrorCode.INTERNAL_PAYMENT_PLATFORM_UNAVAILABLE(blocked)
    }
    rememberCheckout(item.id)
    if (usesWechatCheckoutLink(Capacitor.isNativePlatform(), navigator.userAgent, matchMedia('(pointer:coarse)').matches, navigator.maxTouchPoints, availableModes?.())) {
      const { data: handoff } = await request<{ data: WechatCheckoutLink }>(`/payments/orders/${item.id}/handoff`, { method: 'POST', body: '{}' })
      if (disposed || version !== generation || order.value?.status === 'paid') {
        return
      }
      link.value = handoff.url
      expiresAt.value = handoff.expiresAt
      const code = await QRCode.toDataURL(handoff.url, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      if (disposed || version !== generation) {
        return
      }
      qr.value = code
      preparing = false
      phase.value = stage.value
      return
    }
    if (currentMode() === 'app') {
      const status = await WechatPay.getStatus()
      if (!status.configured) {
        throw ErrorCode.INTERNAL_NATIVE_WECHAT_UNAVAILABLE()
      }
      if (!status.installed) {
        throw ErrorCode.INTERNAL_WECHAT_NOT_INSTALLED()
      }
      await listenNative()
    }
    if (disposed || version !== generation || isPaid()) {
      return
    }
    const { data: intent } = await request<{ data: PaymentIntent }>(`/payments/orders/${item.id}/intent`, { method: 'POST', body: JSON.stringify({ mode: currentMode() }) })
    if (disposed || version !== generation || isPaid()) {
      return
    }
    preparing = false
    if (intent.type === 'redirect') {
      const url = new URL(intent.url)
      if (url.protocol !== 'https:' || !['wx.tenpay.com', 'open.weixin.qq.com'].includes(url.hostname)) {
        throw ErrorCode.INTERNAL_INVALID_WECHAT_PAYMENT_URL()
      }
      location.assign(url.href)
      return
    }
    if (intent.type === 'qr') {
      const code = await QRCode.toDataURL(intent.codeUrl, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      if (disposed || version !== generation) {
        return
      }
      qr.value = code
      phase.value = 'waiting'
    } else if (intent.type === 'jsapi') {
      cashierActive = true
      phase.value = 'paying'
      const result = await chooseWechatPay(item.id, intent.parameters, { active: () => !disposed && version === generation })
      if (version !== generation || disposed || isPaid()) {
        return
      }
      cashierActive = false
      clientResult = result
      phase.value = result === 'ok' ? 'verifying' : 'cancelled'
      notice.value = result === 'ok' ? '正在等待服务端确认到账，结果会自动更新。' : result === 'cancel' ? '你已取消微信支付，订单仍可核对或关闭。' : '微信支付未完成，请核对结果后再试。'
    } else if (intent.type === 'app' && currentMode() === 'app') {
      cashierActive = true
      phase.value = 'paying'
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
    const version = begin(item, true)
    try {
      await startPayment(item, version)
    } catch (cause) {
      if (!disposed && version === generation && open.value && order.value?.status !== 'paid') {
        preparing = false
        cashierActive = false
        phase.value = 'waiting'
        error.value = cause instanceof Error ? cause.message : '发起支付失败'
        notice.value = '订单已保留，可以核对支付结果或关闭订单。'
      }
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
      if (currentMode() === 'app' && !purchaseBlockReason()) {
        await listenNative()
      }
      const { data: item } = await request<{ data: PaymentOrder }>(`/payments/orders/${id}`)
      if (disposed) {
        return
      }
      if (authorized && !purchaseBlockReason() && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now()) {
        await pay(item)
      } else {
        view(item)
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取支付订单失败'
    }
  }
  onBeforeUnmount(() => {
    disposed = true
    close()
    for (const listener of listeners) {
      void listener.remove()
    }
  })
  return { open, order, qr, link, stage, phase, expiresAt, details, notice, error, cancelling, checking, cancelOrder, refresh, pay, resume, view, close }
}
