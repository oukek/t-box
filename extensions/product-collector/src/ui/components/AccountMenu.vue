<script setup lang="ts">
import Modal from '@t-box/ui-kit/Modal.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { extension, request } from '../api'

interface User { id: string, nickname: string, avatarUrl?: string }
const user = ref<User | null>(null)
const candidate = ref<User | null>(null)
const open = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
async function refresh() {
  if (!extension) {
    return
  }
  try {
    user.value = await request<User | null>('account')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法核实登录状态'
  }
}
async function show() {
  open.value = true
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    await refresh()
    candidate.value = extension ? await request<User | null>('account-candidate') : null
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = false
  }
}
async function login(mode: 'quick' | 'other') {
  busy.value = true
  error.value = ''
  try {
    await request('account-login', { mode })
    notice.value = '请在方舟授权窗口完成登录。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '打开登录失败'
  } finally {
    busy.value = false
  }
}
async function logout() {
  busy.value = true
  error.value = ''
  try {
    await request('account-logout')
    user.value = null
    notice.value = '已退出插件账号。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '退出失败，请重试'
  } finally {
    busy.value = false
  }
}
const changed = (_changes: unknown, area: string) => {
  if (area === 'local') {
    void refresh()
    notice.value = ''
  }
}
onMounted(() => {
  void refresh()
  if (extension) {
    chrome.storage.onChanged.addListener(changed)
  }
})
onBeforeUnmount(() => {
  if (extension) {
    chrome.storage.onChanged.removeListener(changed)
  }
})
</script>

<template>
  <button class="account-trigger" @click="show">
    {{ user ? user.nickname : '登录方舟' }}
  </button>
  <Modal
    class="collector-account-dialog"
    :open="open"
    title="方舟账号"
    :busy="busy"
    @close="open = false"
  >
    <div class="collector-account">
      <template v-if="user">
        <img
          v-if="user.avatarUrl"
          :src="user.avatarUrl.startsWith('/') ? `https://api.tboxos.cn${user.avatarUrl}` : user.avatarUrl"
          alt=""
          width="48"
          height="48"
        >
        <strong>
          {{ user.nickname }}
        </strong>
        <span class="muted">
          已登录采集插件
        </span>
        <button :disabled="busy" @click="login('other')">
          登录其他账号
        </button>
        <button :disabled="busy" @click="logout">
          退出登录
        </button>
      </template>
      <template v-else>
        <p>
          登录方舟账号，继续使用采集插件。
        </p>
        <button :disabled="busy" @click="login('quick')">
          {{ candidate ? `以 ${candidate.nickname} 登录` : '登录 / 使用浏览器账号' }}
        </button>
        <button :disabled="busy" @click="login('other')">
          微信扫码登录其他账号
        </button>
      </template>
      <p class="muted">
        商品仍为本机临时预览，尚未上传或认领到账号。
      </p>
      <p v-if="notice" role="status">
        {{ notice }}
      </p>
      <p
        v-if="error"
        role="alert"
        class="error"
      >
        {{ error }}
      </p>
    </div>
  </Modal>
</template>

<style scoped>
.dialog.collector-account-dialog {
  width: min(420px, calc(100vw - 32px));
}
.account-trigger {
  flex-shrink: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collector-account {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 20px 24px;
  overflow-y: auto;
}
.collector-account img {
  border-radius: 50%;
  object-fit: cover;
}
.collector-account p {
  margin: 0;
  line-height: 1.6;
}
@media (max-width: 600px) {
  .dialog.collector-account-dialog {
    width: 100%;
    max-width: 100%;
    margin: auto 0 0;
    border-radius: 18px 18px 0 0;
  }
  .collector-account {
    padding-bottom: max(24px, env(safe-area-inset-bottom));
  }
}
</style>
