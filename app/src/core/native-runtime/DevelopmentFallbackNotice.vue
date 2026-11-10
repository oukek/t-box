<script setup lang="ts">
import { ref } from 'vue'

const server = import.meta.env.VITE_NATIVE_DEV_SERVER
const visible = !import.meta.env.DEV && !!server && !!window.Capacitor?.isNativePlatform?.() && location.origin !== server
const checking = ref(false)
const failed = ref(false)
async function reconnect() {
  if (checking.value || !server) {
    return
  }
  checking.value = true
  failed.value = false
  try {
    const response = await fetch(`${server}/api/v1/health`, { signal: AbortSignal.timeout(4000), cache: 'no-store' })
    const body = response.ok ? await response.json() : null
    if (body?.data?.dependencies?.mysql !== 'up') {
      throw new Error('Not ready')
    }
    location.replace(server)
  } catch {
    failed.value = true
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <aside
    v-if="visible"
    class="development-fallback"
    role="status"
  >
    <div><strong>本地桌面可用</strong><span>{{ failed ? '仍未连接，请在电脑上运行 pnpm dev:ios。' : '开发服务未连接，计算器等本地工具可继续使用。' }}</span></div>
    <button :disabled="checking" @click="reconnect">{{ checking ? '连接中…' : '重新连接' }}</button>
  </aside>
</template>

<style scoped>
.development-fallback {
  position: fixed;
  z-index: 20;
  bottom: calc(12px + env(safe-area-inset-bottom));
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 560px;
  margin: auto;
  padding: 14px 16px;
  border: 1px solid #d5e5df;
  border-radius: 16px;
  background: #f4faf7;
  color: #24483d;
  box-shadow: 0 8px 32px #142c2520;
}
.development-fallback div {
  display: grid;
  gap: 4px;
  flex: 1;
}
.development-fallback strong {
  font-size: 13px;
}
.development-fallback span {
  font-size: 12px;
  line-height: 1.5;
}
.development-fallback button {
  flex-shrink: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: #176d63;
  color: white;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.development-fallback button:disabled {
  opacity: 0.6;
}
.development-fallback button:focus-visible {
  outline: 3px solid #68a99b;
  outline-offset: 3px;
}
</style>
