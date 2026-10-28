<script setup lang="ts">
import { identity, logout, openProfile, updateAvatar, updateNickname } from '@t-box/app-shell-sdk'
import { AppIcon, Modal, UserAvatar } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, ref } from 'vue'
import AccountSecurityPanel from './AccountSecurityPanel.vue'

const logoutOpen = ref(false)
const signingOut = ref(false)
const nicknameOpen = ref(false)
const nickname = ref('')
const nicknameError = ref('')
const nicknameBusy = ref(false)
const nicknameInput = ref<HTMLInputElement>()
const avatarInput = ref<HTMLInputElement>()
const avatarBusy = ref(false)
const avatarError = ref('')
async function changeAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || avatarBusy.value) {
    return
  }
  avatarBusy.value = true
  avatarError.value = ''
  try {
    await updateAvatar(file)
  } catch (cause) {
    avatarError.value = cause instanceof Error ? cause.message : '头像上传失败'
  } finally {
    input.value = ''
    avatarBusy.value = false
  }
}
async function resetAvatar() {
  avatarBusy.value = true
  avatarError.value = ''
  try {
    await updateAvatar(null)
  } catch (cause) {
    avatarError.value = cause instanceof Error ? cause.message : '头像恢复失败'
  } finally {
    avatarBusy.value = false
  }
}
const registeredAt = computed(() => {
  const value = identity.user?.createdAt
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
})
function editNickname() {
  nickname.value = identity.user?.nickname || ''
  nicknameError.value = ''
  nicknameOpen.value = true
}
async function saveNickname() {
  if (nicknameBusy.value) {
    return
  }
  nicknameBusy.value = true
  nicknameError.value = ''
  try {
    await updateNickname(nickname.value.trim())
    nicknameOpen.value = false
  } catch (cause) {
    nicknameError.value =
      cause instanceof Error ? cause.message : '昵称修改失败'
  } finally {
    nicknameBusy.value = false
  }
}
async function signOut() {
  if (signingOut.value) {
    return
  }
  signingOut.value = true
  try {
    await logout()
  } catch {
    /* Logout clears the local session even when offline. */
  } finally {
    signingOut.value = false
    logoutOpen.value = false
  }
}
</script>

<template>
  <section class="account-settings-page">
    <ApplicationHeader
      title="账号设置"
      back-label="设置"
      @back="openProfile()"
    />
    <div class="settings-group">
      <h2>账号信息</h2>
      <dl class="account-details">
        <div>
          <dt>头像</dt>
          <dd class="account-avatar-actions"><button
            class="account-avatar-edit"
            :disabled="avatarBusy"
            aria-label="修改头像"
            @click="avatarInput?.click()"
          ><UserAvatar :src="identity.user?.avatarUrl" :size="48" /><span>{{ avatarBusy ? '正在上传…' : '修改头像' }}</span></button><button
            v-if="identity.user?.avatarUrl"
            class="text-button"
            :disabled="avatarBusy"
            @click="resetAvatar"
          >恢复默认</button><input
            ref="avatarInput"
            class="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            :disabled="avatarBusy"
            aria-label="选择头像图片"
            @change="changeAvatar"
          ></dd>
        </div>
        <div>
          <dt>昵称</dt>
          <dd>
            <button
              class="account-nickname"
              aria-label="修改昵称"
              @click="editNickname"
            >
              {{ identity.user?.nickname }}<AppIcon name="right" :size="16" />
            </button>
          </dd>
        </div>
        <div>
          <dt>登录方式</dt>
          <dd>微信授权登录</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>{{ registeredAt }}</dd>
        </div>
      </dl>
      <p
        v-if="avatarError"
        class="form-error"
        role="alert"
      >{{ avatarError }}</p>
    </div>
    <div class="settings-group">
      <h2>安全</h2>
      <div class="profile-menu">
        <AccountSecurityPanel />
      </div>
    </div>
    <div class="settings-session-actions">
      <button class="settings-logout" @click="logoutOpen = true">
        <AppIcon name="logout" :size="18" />退出登录
      </button>
    </div>
    <Modal
      :open="nicknameOpen"
      title="修改昵称"
      :busy="nicknameBusy"
      @close="nicknameOpen = false"
      @opened="nicknameInput?.focus()"
    >
      <form id="nickname-form" @submit.prevent="saveNickname">
        <label class="form-field">昵称<input
          ref="nicknameInput"
          v-model="nickname"
          autocomplete="nickname"
          required
          maxlength="40"
          :disabled="nicknameBusy"
          placeholder="怎么称呼你？"
        ></label>
        <p class="muted">最多 40 个字符，共享账本的成员也会看到此昵称。</p>
        <p
          v-if="nicknameError"
          class="form-error"
          role="alert"
        >
          {{ nicknameError }}
        </p>
      </form>
      <footer class="dialog-footer">
        <button
          type="button"
          class="button button-secondary"
          :disabled="nicknameBusy"
          @click="nicknameOpen = false"
        > 取消</button><button
          form="nickname-form"
          class="button button-primary"
          :disabled="nicknameBusy || !nickname.trim()"
        >
          {{ nicknameBusy ? "正在保存…" : "保存昵称" }}
        </button>
      </footer>
    </Modal>
    <Modal
      :open="logoutOpen"
      title="退出登录？"
      :busy="signingOut"
      @close="logoutOpen = false"
    >
      <p class="muted">退出后需要重新登录。你的账本、会话和资源会保留。</p>
      <footer class="dialog-footer">
        <button
          class="button button-secondary"
          :disabled="signingOut"
          @click="logoutOpen = false"
        > 取消</button><button
          class="button button-danger"
          :disabled="signingOut"
          @click="signOut"
        >
          {{ signingOut ? "正在退出…" : "确认退出" }}
        </button>
      </footer>
    </Modal>
  </section>
</template>
