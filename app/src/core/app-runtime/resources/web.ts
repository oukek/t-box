import type { ApplicationPackage, ResourceAdapter, ResourceProgress } from './contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { ErrorCode } from '../../../error-codes'

/** The hidden installer is platform code generated into each artifact, not an app SDK feature. */
export class WebResourceAdapter implements ResourceAdapter {
  private ready = new Set<string>()
  async prepare(pkg: ApplicationPackage, progress?: (value: ResourceProgress) => void): Promise<'ready' | 'unsupported'> {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      if (!navigator.onLine) {
        throw SdkErrorCode.NETWORK_REQUIRED('此浏览器无法离线保存应用资源，请联网后使用')
      }
      return 'unsupported'
    }
    const nonce = crypto.randomUUID()
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('aria-hidden', 'true')
    frame.sandbox.add('allow-scripts', 'allow-same-origin')
    const url = new URL('tbox-resource.html', pkg.entryUrl)
    url.searchParams.set('host', location.origin)
    url.searchParams.set('nonce', nonce)
    const origin = url.origin
    const result = await new Promise<'ready' | 'unsupported'>((resolve, reject) => {
      let available = false
      let legacy: ReturnType<typeof setTimeout> | undefined
      let timer: ReturnType<typeof setTimeout>
      let settled = false
      function done(error?: Error, state: 'ready' | 'unsupported' = 'ready') {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        clearTimeout(legacy)
        window.removeEventListener('message', receive)
        frame.remove()
        frame.onload = null
        error ? reject(error) : resolve(state)
      }
      // Overall bound also covers a bootstrap page that never executes (404/CSP/storage denial).
      timer = setTimeout(() => done(navigator.onLine ? ErrorCode.INTERNAL_APPLICATION_RESOURCES_TIMEOUT() : SdkErrorCode.NETWORK_REQUIRED('本机没有完整的应用资源，请联网打开一次后再离线使用')), navigator.onLine ? 120_000 : 5000)
      const ready = this.ready
      function receive(event: MessageEvent) {
        const data = event.data
        if (event.source !== frame.contentWindow || event.origin !== origin || !data || data.protocol !== 'tbox.resources.v1' || data.nonce !== nonce || data.digest !== pkg.digest) {
          return
        }
        if (data.status === 'available') {
          available = true
        } else if (data.status === 'progress' && Number.isSafeInteger(data.completed) && Number.isSafeInteger(data.total) && data.total > 0 && data.completed >= 0 && data.completed <= data.total && Number.isSafeInteger(data.bytes)) {
          progress?.({ completed: data.completed, total: data.total, bytes: data.bytes })
        } else if (data.status === 'ready') {
          ready.add(pkg.entryUrl)
          done()
        } else if (data.status === 'unsupported') {
          done(navigator.onLine ? undefined : SdkErrorCode.NETWORK_REQUIRED('应用资源尚未在此浏览器保存，请联网后重试'), 'unsupported')
        } else if (data.status === 'failed') {
          done(ErrorCode.INTERNAL_APPLICATION_RESOURCES_FAILED(typeof data.message === 'string' ? data.message.slice(0, 160) : undefined))
        }
      }
      window.addEventListener('message', receive)
      frame.onload = () => {
        legacy = setTimeout(() => {
          if (!available) {
            done(navigator.onLine ? undefined : SdkErrorCode.NETWORK_REQUIRED('本机没有完整的应用资源，请联网打开一次后再离线使用'), 'unsupported')
          }
        }, 1000)
      }
      frame.src = url.href
      document.body.append(frame)
    })
    return result
  }

  async open(pkg: ApplicationPackage) {
    return { entryUrl: pkg.entryUrl, origin: new URL(pkg.entryUrl).origin, source: this.ready.has(pkg.entryUrl) ? 'local' as const : 'network' as const }
  }

  async remove(pkg: ApplicationPackage) {
    this.ready.delete(pkg.entryUrl)
    // A fresh installer request asks its own origin to remove only this digest.
    await this.prepareRemoval(pkg)
  }

  private async prepareRemoval(pkg: ApplicationPackage) {
    const frame = document.createElement('iframe')
    frame.hidden = true
    const url = new URL('tbox-resource.html', pkg.entryUrl)
    url.searchParams.set('host', location.origin)
    url.searchParams.set('nonce', crypto.randomUUID())
    url.searchParams.set('remove', '1')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, 5000)
      function finish() {
        clearTimeout(timer)
        window.removeEventListener('message', receive)
        frame.remove()
        resolve()
      }
      function receive(event: MessageEvent) {
        if (event.source === frame.contentWindow && event.origin === url.origin && event.data?.nonce === url.searchParams.get('nonce') && event.data?.status === 'removed') {
          finish()
        }
      }
      window.addEventListener('message', receive)
      frame.src = url.href
      document.body.append(frame)
    })
  }
}
