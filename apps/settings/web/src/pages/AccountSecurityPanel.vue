<script setup lang="ts">
import type { AccountSession } from '@t-box/shared'
import { invalidateSession, request } from '@t-box/app-shell-sdk'
import { AppIcon, Modal } from '@t-box/ui-kit'
import { ref } from 'vue'

const devicesOpen = ref(false)
const sessions = ref<AccountSession[]>([])
const busy = ref(false)
const error = ref('')
const revoke = ref<{ id?: string, label: string } | null>(null)
async function loadDevices() {
  devicesOpen.value = true
  error.value = ''
  busy.value = true
  try {
    sessions.value = (
      await request<{ data: AccountSession[] }>('/auth/sessions')
    ).data
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录设备读取失败'
  } finally {
    busy.value = false
  }
}
async function confirmRevoke() {
  if (!revoke.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await request<{ data: { current: boolean } } | undefined>(
      revoke.value.id ? `/auth/sessions/${revoke.value.id}` : '/auth/sessions',
      { method: 'DELETE' },
    )
    if (result?.data.current) {
      invalidateSession()
    }
    revoke.value = null
    sessions.value = (
      await request<{ data: AccountSession[] }>('/auth/sessions')
    ).data
  } catch (e) {
    error.value = e instanceof Error ? e.message : '退出设备失败'
  } finally {
    busy.value = false
  }
}
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '暂无活跃记录'
</script>

<template>
  <button class="profile-action" @click="loadDevices">
    <span class="profile-action-icon"><AppIcon name="apps" :size="19" /></span><span>登录设备<small>查看与退出其他设备</small></span><AppIcon name="right" :size="17" />
  </button>
  <Modal
    :open="devicesOpen"
    title="登录设备"
    :busy="busy"
    @close="devicesOpen = false"
  >
    <p class="security-note">
      最近活跃时间约每 5
      分钟更新。退出设备后，该设备的登录和依赖此登录的后台任务将失效。
    </p>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >{{ error }}</p>
    <p v-if="busy && !sessions.length" class="security-note">正在读取…</p>
    <ul class="session-list">
      <li v-for="session in sessions" :key="session.id">
        <div>
          <strong>{{ session.device
          }}<span v-if="session.current">当前设备</span></strong><small>{{ time(session.lastSeenAt) }}</small>
        </div>
        <button
          v-if="!session.current"
          class="session-revoke"
          :disabled="busy"
          @click="revoke = { id: session.id, label: session.device }"
        >
          退出
        </button>
      </li>
    </ul>
    <template #footer><button
      class="button button-secondary"
      :disabled="busy"
      @click="devicesOpen = false"
    >
      关闭</button><button
      v-if="sessions.some((session) => !session.current)"
      class="button button-primary"
      :disabled="busy"
      @click="revoke = { label: '其他所有设备' }"
    >
      退出其他设备
    </button></template>
  </Modal>
  <Modal
    :open="!!revoke"
    title="退出设备登录？"
    :busy="busy"
    @close="revoke = null"
  ><p class="security-note">
     将退出 {{ revoke?.label }} 的登录。已完成的操作和文件会保留。
   </p>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >{{ error }}</p>
    <template #footer><button
      class="button button-secondary"
      :disabled="busy"
      @click="revoke = null"
    >
      取消</button><button
      class="button button-primary"
      :disabled="busy"
      @click="confirmRevoke"
    >
      确认退出
    </button></template></Modal>
</template>

<style scoped>
.security-note {
  color: var(--muted, #73817b);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 18px;
}
.session-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 45vh;
  overflow: auto;
}
.session-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid #e9eeeb;
  gap: 12px;
}
.session-list strong {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 550;
}
.session-list strong span {
  color: #438270;
  font-size: 11px;
  font-weight: 400;
}
.session-list small {
  display: block;
  color: #88968f;
  font-size: 11px;
  margin-top: 7px;
}
.session-revoke {
  background: transparent;
  border: 0;
  color: #99746c;
  font: inherit;
  font-size: 12px;
  padding: 10px;
  cursor: pointer;
}
</style>
