<script setup lang="ts">
import type { UserSession } from '@t-box/shared'
import type { DesktopAccount } from './desktopLogin'
import { UserAvatar } from '@t-box/ui-kit'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { desktopPermission, detectDesktopAccount, loginFromDesktop } from './desktopLogin'

const props = defineProps<{ handoff?: (account: DesktopAccount, signal: AbortSignal) => Promise<void>, disabled?: boolean }>()
const emit = defineEmits<{ login: [session: UserSession], busy: [value: boolean], start: [], available: [value: boolean], other: [], settled: [found: boolean] }>()
const supported = !window.__TBOX_DESKTOP_KEY__ && !window.Capacitor?.isNativePlatform?.() && /Mac/.test(navigator.platform)
const account = ref<DesktopAccount | null>(null)
const checking = ref(false)
const busy = ref(false)
const permissionRequired = ref(false)
const choseOther = ref(false)
const optInKey = 'tbox.desktop.discovery.v1'
let mounted = true
const controller = new AbortController()
async function detect() {
  if (checking.value || busy.value) {
    return
  }
  checking.value = true
  account.value = null
  try {
    const found = await detectDesktopAccount()
    if (mounted && !choseOther.value) {
      account.value = found
      permissionRequired.value = false
      emit('available', true)
      try {
        localStorage.setItem(optInKey, 'allowed')
      } catch { /* Session-only browser. */ }
    }
  } catch {
    // An unavailable Mac is normal: keep the QR login untouched.
  } finally {
    checking.value = false
    if (mounted) {
      emit('settled', !!account.value)
    }
  }
}
async function login() {
  if (!account.value || busy.value || props.disabled) {
    return
  }
  busy.value = true
  emit('busy', true)
  emit('start')
  try {
    if (props.handoff) {
      await props.handoff(account.value, controller.signal)
    } else {
      const session = await loginFromDesktop(account.value, controller.signal)
      if (mounted) {
        emit('login', session)
      }
    }
  } catch {
    if (mounted) {
      other()
    }
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
function other() {
  choseOther.value = true
  account.value = null
  permissionRequired.value = false
  emit('available', false)
  emit('other')
}
onMounted(async () => {
  if (!supported) {
    emit('settled', false)
    return
  }
  const permission = await desktopPermission()
  if (!mounted) {
    return
  }
  let optedIn = false
  try {
    optedIn = localStorage.getItem(optInKey) === 'allowed'
  } catch { /* Explicit click remains available. */ }
  if (permission === 'granted' || (permission === 'unknown' && optedIn)) {
    void detect()
  } else {
    permissionRequired.value = permission !== 'denied'
    emit('settled', false)
  }
})
onBeforeUnmount(() => {
  mounted = false
  controller.abort()
  emit('available', false)
})
</script>

<template>
  <section
    v-if="supported && account"
    class="desktop-quick-login"
    aria-label="Mac 版快捷登录"
  >
    <div class="desktop-account"><UserAvatar :src="account.user.avatarUrl" :size="64" /><strong>{{ account.user.nickname }}</strong></div>
    <button
      type="button"
      class="wechat-login-primary"
      :disabled="busy || disabled"
      @click="login"
    >{{ busy ? '正在登录…' : '使用 Mac 账号快速登录' }}</button>
    <button
      type="button"
      class="wechat-login-secondary"
      :disabled="busy || disabled"
      @click="other"
    >使用其他账号</button>
  </section>
  <button
    v-else-if="supported && permissionRequired && !choseOther"
    type="button"
    class="wechat-login-secondary desktop-discovery"
    :disabled="checking || disabled"
    @click="detect"
  >使用 Mac 账号</button>
</template>

<style scoped>
.desktop-quick-login {
  display: grid;
  gap: 10px;
  width: 100%;
  padding: 16px 0;
}
.desktop-account {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.desktop-account span {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.desktop-account small,
p,
[role='status'] {
  font-size: 12px;
  color: var(--muted, #6e7d86);
  line-height: 1.6;
  margin: 0;
}
</style>
