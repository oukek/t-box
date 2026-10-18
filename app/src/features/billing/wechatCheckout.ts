import type { PluginListenerHandle } from '@capacitor/core'
import type {
  PaymentIntent,
  PaymentOrder,
  WechatPaymentMode,
} from '@t-box/shared'
import { Capacitor } from '@capacitor/core'
import { WechatPay } from '@t-box/capacitor-wechat-pay'
import QRCode from 'qrcode'
import { onBeforeUnmount, ref } from 'vue'
import { request } from '../../core/network'
import { ErrorCode } from '../../error-codes.js'
import {
  billingPurchaseBlockReason,
  selectPaymentMode,
} from './paymentEnvironment'
import {
  forgetCheckout,
  pendingCheckout,
  rememberCheckout,
} from './pendingCheckout'

type Jsapi = Extract<PaymentIntent, { type: 'jsapi' }>
interface Bridge {
  invoke(
    name: string,
    parameters: Jsapi['parameters'],
    callback: (result: { err_msg: string }) => void,
  ): void
}
async function bridge(): Promise<Bridge> {
  const get = () =>
    (window as Window & { WeixinJSBridge?: Bridge }).WeixinJSBridge
  if (get()) {
    return get()!
  }
  return new Promise((resolve, reject) => {
    const done = () => {
      if (get()) {
        // eslint-disable-next-line ts/no-use-before-define -- The listener is registered after the timer is initialized.
        clearTimeout(timer)
        document.removeEventListener('WeixinJSBridgeReady', done)
        resolve(get()!)
      }
    }
    const timer = setTimeout(() => {
      document.removeEventListener('WeixinJSBridgeReady', done)
      reject(ErrorCode.INTERNAL_APPLICATION_EXECUTION_FAILED())
    }, 8000)
    document.addEventListener('WeixinJSBridgeReady', done)
  })
}
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
  const notice = ref('')
  const error = ref('')
  const open = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let disposed = false
  const listeners: PluginListenerHandle[] = []
  let nativeListeners: Promise<void> | undefined
  let polling: number | undefined
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
            if (polling !== generation) {
              clearTimeout(timer)
              void poll(order.value.id, generation)
            }
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
    clearTimeout(timer)
    open.value = false
    qr.value = ''
  }
  async function poll(id: string, version: number, attempt = 0) {
    if (version !== generation || disposed || polling === version) {
      return
    }
    polling = version
    try {
      const result = await request<{ data: PaymentOrder }>(
        `/payments/orders/${id}${attempt % 5 === 0 ? '/refresh' : ''}`,
        attempt % 5 === 0 ? { method: 'POST' } : {},
      )
      if (version !== generation || disposed) {
        return
      }
      order.value = result.data
      if (result.data.status === 'paid') {
        notice.value = '充值已到账'
        qr.value = ''
        forgetCheckout()
        await onPaid()
        return
      }
      if (
        result.data.status === 'closed' ||
        Date.parse(result.data.expiresAt) <= Date.now()
      ) {
        notice.value = purchaseBlockReason()
          ? '订单已关闭或过期'
          : '订单已关闭或过期，请重新充值'
        qr.value = ''
        forgetCheckout()
        return
      }
      error.value = ''
      notice.value = clientHint || '等待支付确认，完成后余额会自动更新'
    } catch (e) {
      if (version === generation) {
        error.value = e instanceof Error ? e.message : '核对支付结果失败'
      }
    } finally {
      if (polling === version) {
        polling = undefined
      }
    }
    if (version === generation && !disposed) {
      timer = setTimeout(() => void poll(id, version, attempt + 1), 3000)
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
    clientHint = ''
    notice.value = '正在准备支付…'
    order.value = item
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
      const sdk = await bridge()
      const result = await new Promise<string>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(ErrorCode.INTERNAL_PAYMENT_RESULT_UNKNOWN()),
          120_000,
        )
        sdk.invoke('getBrandWCPayRequest', intent.parameters, (r) => {
          clearTimeout(deadline)
          resolve(r.err_msg)
        })
      })
      if (version !== generation || disposed) {
        return
      }
      notice.value = result.endsWith(':cancel')
        ? '已取消支付，可在原订单中继续'
        : result.endsWith(':ok')
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
    void poll(item.id, version)
  }
  async function pay(item: PaymentOrder) {
    try {
      await startPayment(item)
    } catch (e) {
      if (!disposed) {
        error.value = e instanceof Error ? e.message : '发起支付失败'
        notice.value = purchaseBlockReason() || '可在充值订单中核对或继续支付'
      }
      if (open.value && order.value?.status === 'pending') {
        void poll(order.value.id, generation)
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
        void poll(id, generation)
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
  return { open, order, qr, notice, error, pay, resume, close }
}
