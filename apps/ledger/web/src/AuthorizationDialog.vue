<script setup lang="ts">
import { Modal } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'
import {
  applicationAuthorization as auth,
  resolveApplicationAuthorization,
} from './applicationAuthorization'
import { bookState, loadBooks } from './books/bookStore'
import { request } from './sdk'

const includeWrite = ref(false)
const canIncludeWrite = computed(() => {
  const book = bookState.books.find((b) => b.id === auth.ledgerId)
  return (
    auth.scope === 'read' && book && book.role !== 'viewer' && !book.archived
  )
})
const scope = computed(() =>
  auth.scope === 'write' || (canIncludeWrite.value && includeWrite.value)
    ? 'write'
    : 'read',
)
const password = ref('')
const error = ref('')
const busy = ref(false)
watch(
  () => auth.open,
  () => {
    password.value = ''
    includeWrite.value = false
    error.value = ''
  },
)
async function authorize() {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  const id = auth.ledgerId
  try {
    await request(`/ledgers/${id}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password: password.value, scope: scope.value }),
    })
    password.value = ''
    await loadBooks()
    if (auth.open && auth.ledgerId === id) {
      resolveApplicationAuthorization(true)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '授权失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal
    :open="auth.open"
    title="授权账本操作"
    :busy="busy"
    @close="resolveApplicationAuthorization(false)"
  >
    <p class="authorization-book">
      {{ auth.ledgerName }}
    </p>
    <p class="muted">
      {{ auth.purpose }} · {{ scope === "write" ? "查看与写入" : "仅查看" }} ·
      有效期 10 分钟
    </p>
    <form @submit.prevent="authorize">
      <label class="form-field">账本密码<input
        v-model="password"
        type="password"
        required
        maxlength="128"
        autocomplete="off"
        placeholder="密码仅提交给授权接口"
      ></label>
      <label
        v-if="canIncludeWrite"
        class="authorization-write-option"
      ><input
        v-model="includeWrite"
        type="checkbox"
      >同时允许此账本的写入（10 分钟）</label>
      <p class="muted">密码不会发送给 AI。取消后，此操作不会继续执行。</p>
      <p
        v-if="error"
        class="form-error"
        role="alert"
      >
        {{ error }}
      </p>
      <footer class="dialog-footer">
        <button
          type="button"
          class="button button-secondary"
          :disabled="busy"
          @click="resolveApplicationAuthorization(false)"
        > 取消</button><button class="button button-primary" :disabled="busy">
          {{ busy ? "正在授权…" : "授权并继续" }}
        </button>
      </footer>
    </form>
  </Modal>
</template>
