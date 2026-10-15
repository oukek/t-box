<script setup lang="ts">
import type { AccountSession, RecoveryCodeStatus } from '@t-box/shared'
import { invalidateSession, request } from '@t-box/app-shell-sdk'
import { AppIcon, Modal } from '@t-box/ui-kit'
import { ref } from 'vue'

const devicesOpen = ref(false)
const recoveryOpen = ref(false)
const sessions = ref<AccountSession[]>([])
const status = ref<RecoveryCodeStatus | null>(null)
const codes = ref<string[]>([])
const password = ref('')
const busy = ref(false)
const error = ref('')
const copied = ref(false)
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
async function showRecovery() {
  codes.value = []
  password.value = ''
  copied.value = false
  recoveryOpen.value = true
  error.value = ''
  busy.value = true
  try {
    status.value = (
      await request<{ data: RecoveryCodeStatus }>('/auth/recovery-codes')
    ).data
  } catch (e) {
    error.value = e instanceof Error ? e.message : '恢复设置读取失败'
  } finally {
    busy.value = false
  }
}
function closeRecovery() {
  recoveryOpen.value = false
  codes.value = []
  password.value = ''
}
async function generate() {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    codes.value = (
      await request<{ data: { codes: string[] } }>('/auth/recovery-codes', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: password.value }),
      })
    ).data.codes
    password.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '恢复码生成失败'
  } finally {
    busy.value = false
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(codes.value.join('\n'))
    copied.value = true
  } catch {
    error.value = '无法复制，请手动选择并保存恢复码'
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
  <button class="profile-action" @click="showRecovery">
    <span class="profile-action-icon"><AppIcon name="lock" :size="19" /></span><span>账号恢复码<small>忘记密码时安全找回账号</small></span><AppIcon name="right" :size="17" />
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
  <Modal
    :open="recoveryOpen"
    title="账号恢复码"
    :busy="busy"
    @close="closeRecovery"
  >
    <template v-if="codes.length"><p class="security-note">
                                    恢复码只显示这一次，请保存在安全的位置。每个码仅能重置密码一次，不要发给其他人。
                                  </p>
      <ol class="recovery-codes">
        <li v-for="code in codes" :key="code">
          <code>{{ code }}</code>
        </li>
      </ol>
      <button class="button button-secondary" @click="copy">
        {{ copied ? '已复制' : '复制恢复码' }}
      </button></template>
    <form
      v-else
      id="recovery-codes-form"
      @submit.prevent="generate"
    >
      <p class="security-note">
        {{
          status?.remaining
            ? `剩余 ${status.remaining} 个可用恢复码。重新生成后旧码全部失效。`
            : '还没有可用恢复码。先设置并保存，忘记密码时可在登录页使用。'
        }}
      </p>
      <label class="form-field">当前登录密码<input
        v-model="password"
        type="password"
        autocomplete="current-password"
        minlength="6"
        maxlength="128"
        required
        :disabled="busy"
        placeholder="验证身份后生成恢复码"
      ></label>
    </form>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >{{ error }}</p>
    <template #footer><button
      class="button button-secondary"
      :disabled="busy"
      @click="closeRecovery"
    >
      {{ codes.length ? '已保存，关闭' : '取消' }}</button><button
      v-if="!codes.length"
      class="button button-primary"
      type="submit"
      form="recovery-codes-form"
      :disabled="busy || password.length < 6"
    >
      {{
        busy
          ? '正在处理…'
          : status?.remaining
            ? '重新生成恢复码'
            : '生成恢复码'
      }}
    </button></template>
  </Modal>
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
.recovery-codes {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 10px;
}
.recovery-codes code {
  display: block;
  padding: 9px;
  border-radius: 6px;
  background: #f4f7f5;
  font-size: 11px;
  overflow-wrap: anywhere;
  user-select: all;
}
</style>
