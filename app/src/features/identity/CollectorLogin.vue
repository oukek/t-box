<script setup lang="ts">
import type { AppUser } from '@t-box/shared'
import { AppIcon, BrandMark, UserAvatar } from '@t-box/ui-kit'
import QRCode from 'qrcode'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { request } from '../../core/network'
import { watchQrState } from '../../core/qrSocket'
import { identity } from '../../core/session'

interface Flow { id: string, secret: string, qrUrl: string, expiresAt: string, mode: string }
interface Runtime { sendMessage: (id: string, message: unknown) => Promise<{ ok: boolean, data: unknown, error?: string }> }
const match = /^#collector-login=([a-p]{32})\.([a-f0-9-]{36})$/.exec(location.hash)
const runtime = (window as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime
const user = ref<AppUser | null>(null)
const qr = ref('')
const error = ref('')
const phase = ref('loading')
const busy = ref(false)
let flow: Flow | undefined
let stop: (() => void) | undefined
let expiry: ReturnType<typeof setTimeout> | undefined
let completing = false
async function extension<T>(action: string): Promise<T> {
  if (!match || !runtime || window.top !== window) {
    throw new Error('请从 T方舟采集插件打开登录窗口')
  }
  const response = await runtime.sendMessage(match[1], { action, nonce: match[2] })
  if (!response.ok) {
    throw new Error(response.error || '插件连接失败')
  }
  return response.data as T
}
function fail(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : '登录失败，请重试'
}
async function finish() {
  if (completing) {
    return
  }
  completing = true
  busy.value = true
  try {
    await extension('collector-complete')
    stop?.()
    clearTimeout(expiry)
    phase.value = 'done'
    error.value = ''
  } catch (cause) {
    fail(cause)
  } finally {
    busy.value = false
  }
}
function subscribe() {
  if (!flow) {
    return
  }
  stop?.()
  stop = watchQrState({ type: 'login', id: flow.id, secret: flow.secret }, (event) => {
    if (event.type !== 'login.state') {
      return
    }
    if (event.data.status === 'complete') {
      void finish()
    } else if (event.data.status === 'scanned') {
      phase.value = 'scanned'
    } else if (['failed', 'cancelled', 'expired'].includes(event.data.status)) {
      phase.value = 'error'
      error.value = '本次登录已结束，请关闭窗口后从插件重新登录。'
    }
  }, (message) => {
    if (phase.value !== 'done') {
      error.value = message
    }
  })
}
async function other() {
  if (!flow || busy.value) {
    return
  }
  error.value = ''
  qr.value = await QRCode.toDataURL(flow.qrUrl, { width: 224, margin: 1 })
  phase.value = 'qr'
}
async function approve() {
  if (!flow || !user.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await request('/auth/wechat/collector/approve', { method: 'POST', body: JSON.stringify({ id: flow.id, secret: flow.secret, userId: user.value.id }) })
    await finish()
  } catch (cause) {
    fail(cause)
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  try {
    flow = await extension<Flow>('collector-connect')
    expiry = setTimeout(() => {
      if (phase.value !== 'done') {
        stop?.()
        phase.value = 'error'
        error.value = '登录已过期，请关闭窗口后从插件重新登录。'
      }
    }, Math.max(1, Date.parse(flow.expiresAt) - Date.now()))
    if (flow.mode !== 'other' && identity.token) {
      try {
        user.value = (await request<{ data: AppUser }>('/auth/me', { timeoutMs: 5000 })).data
      } catch { /* Fall back to a fresh QR login, preserving the main site's account. */ }
    }
    if (user.value) {
      phase.value = 'account'
    } else {
      await other()
    }
    subscribe()
  } catch (cause) {
    phase.value = 'error'
    fail(cause)
  }
})
onBeforeUnmount(() => {
  stop?.()
  clearTimeout(expiry)
})
</script>

<template>
  <main class="collector-login-page">
    <div class="wechat-login-brand"><BrandMark class="identity-brand-mark" /><span>T方舟<small>采集插件登录</small></span></div>
    <template v-if="phase === 'account' && user">
      <UserAvatar :src="user.avatarUrl" :size="64" />
      <h1>{{ user.nickname }}</h1>
      <p>使用同浏览器已登录的方舟账号</p>
      <button
        class="wechat-login-primary"
        :disabled="busy"
        @click="approve"
      >{{ busy ? '正在登录…' : '以此账号登录插件' }}<AppIcon name="right" :size="16" /></button>
      <button
        class="wechat-login-secondary"
        :disabled="busy"
        @click="other"
      >登录其他账号</button>
    </template>
    <template v-else-if="phase === 'qr' || phase === 'scanned'">
      <h1>微信扫码登录插件</h1>
      <img
        :src="qr"
        width="224"
        height="224"
        alt="使用微信扫描二维码登录插件"
      >
      <p role="status">{{ phase === 'scanned' ? '已扫码，请在手机上确认登录采集插件' : '请用要登录的微信扫一扫，二维码 5 分钟内有效' }}</p>
      <p class="muted">本次登录不会切换此浏览器的方舟网站账号。</p>
    </template>
    <template v-else-if="phase === 'done'">
      <AppIcon name="check" :size="36" /><h1>插件已登录</h1><p>返回采集箱即可继续使用，可以关闭此窗口。</p>
    </template>
    <p v-else-if="phase === 'loading'" role="status">正在连接采集插件…</p>
    <p
      v-if="error"
      role="alert"
      class="wechat-login-error"
    >{{ error }}</p>
  </main>
</template>

<style scoped>
.collector-login-page {
  min-height: 100dvh;
  box-sizing: border-box;
  max-width: 460px;
  margin: auto;
  padding: 36px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  text-align: center;
}
h1 {
  font-size: 21px;
  margin: 0;
}
p {
  margin: 0;
  line-height: 1.6;
}
button {
  width: 100%;
}
.wechat-login-brand {
  margin-bottom: 12px;
}
</style>
