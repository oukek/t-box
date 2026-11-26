<script setup lang="ts">
import type { UserSession } from '@t-box/shared'
import { Modal } from '@t-box/ui-kit'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { ref } from 'vue'
import { request } from '../../core/network'
import { setSession } from '../../core/session'

const emit = defineEmits<{ close: [] }>()
const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
async function submit() {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const { data } = await request<{ data: UserSession }>('/auth/password/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
    })
    setSession(data)
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal
    open
    title="账号密码登录"
    :busy="busy"
    @close="!busy && emit('close')"
  >
    <form class="password-login" @submit.prevent="submit">
      <label>账号<FormControl
        v-model="username"
        autocomplete="username"
        autocapitalize="none"
        required
        maxlength="64"
      /></label>
      <label>密码<FormControl
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        maxlength="128"
      /></label>
      <p
        v-if="error"
        role="alert"
        class="form-error"
      >{{ error }}</p>
      <button
        type="submit"
        class="button button-primary"
        :disabled="busy"
      >{{ busy ? '正在登录…' : '登录' }}</button>
    </form>
  </Modal>
</template>

<style scoped>
.password-login,
.password-login label {
  display: grid;
  gap: 8px;
}
.password-login {
  gap: 16px;
}
</style>
