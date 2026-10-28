import type { WechatCheckoutState, WechatLoginResult } from '@t-box/shared'
import { chatWebSocketUrl } from './network'

export type QrSubscription = { type: 'login', id: string, secret: string } | { type: 'payment', token: string, orderId: string } | { type: 'handoff', token: string, ticket: string }
export type QrStateEvent = { type: 'login.state', data: WechatLoginResult } | { type: 'payment.state', data: WechatCheckoutState }

/** Reconnect the transport and receive a fresh snapshot; no HTTP status polling. */
export function watchQrState(subscription: QrSubscription, receive: (event: QrStateEvent) => void, failure: (message: string) => void) {
  let socket: WebSocket | undefined
  let stopped = false
  let rejected = false
  let retry = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const connect = () => {
    if (stopped || rejected) {
      return
    }
    clearTimeout(timer)
    socket?.close()
    const current = new WebSocket(chatWebSocketUrl('/qr/ws'))
    socket = current
    current.onopen = () => {
      if (!stopped && current === socket) {
        current.send(JSON.stringify(subscription))
      }
    }
    current.onmessage = (message) => {
      if (stopped || current !== socket) {
        return
      }
      try {
        const event = JSON.parse(message.data)
        if (event.type === 'error') {
          failure(event.message || '状态连接暂时不可用')
        } else if (event.type === 'login.state' || event.type === 'payment.state') {
          retry = 0
          receive(event)
        }
      } catch {
        failure('状态消息无效，请重新连接')
      }
    }
    current.onclose = (event) => {
      if (stopped || current !== socket) {
        return
      }
      rejected = event.code === 1008
      if (!rejected && event.code !== 1000) {
        failure('状态连接已断开，正在重新连接…')
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10_000))
      }
    }
    current.onerror = () => { /* close schedules reconnection. */ }
  }
  const online = () => {
    if (!socket || socket.readyState > 1) {
      connect()
    }
  }
  window.addEventListener('online', online)
  connect()
  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('online', online)
    socket?.close()
  }
}
