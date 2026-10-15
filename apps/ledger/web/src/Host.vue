<script setup lang="ts">
import { BottomSheet, Modal } from '@t-box/ui-kit'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveApplicationAuthorization } from './applicationAuthorization'
import ApplicationAuthorizationDialog from './AuthorizationDialog.vue'
import { booksApi } from './books/booksApi'
import { bookState, loadBooks, resetBooks, selectBook } from './books/bookStore'
import { startBookLive } from './books/live'
import { financialConsent, resolveFinancialConsent } from './financialConsent'
import { identity, openApplication, runtime } from './runtime'

let stopLive: (() => void) | undefined
const invitation = ref('')
const inviteError = ref('')
const joining = ref(false)
function readInvitation() {
  invitation.value = runtime.params.inviteToken || ''
}
async function join() {
  joining.value = true
  inviteError.value = ''
  try {
    const result = await booksApi.join(invitation.value)
    await loadBooks()
    selectBook(result.data.id)
    invitation.value = ''
    await openApplication({
      appId: 'ledger',
      params: { ledgerId: result.data.id },
    })
  } catch (cause) {
    inviteError.value = cause instanceof Error ? cause.message : '加入失败'
  } finally {
    joining.value = false
  }
}
watch(
  () => identity.user?.id,
  async (id) => {
    stopLive?.()
    if (!id) {
      resetBooks()
    }
    if (id) {
      if (!bookState.books.length) {
        await loadBooks()
      }
      if (identity.user?.id !== id) {
        return
      }
      stopLive = startBookLive()
    }
  },
  // Start connections on remount too: HMR preserves the authenticated identity.
  { immediate: true },
)
onMounted(() => {
  readInvitation()
})
watch(() => runtime.params.inviteToken, readInvitation)
onBeforeUnmount(() => {
  stopLive?.()
  resolveFinancialConsent(false)
  resolveApplicationAuthorization(false)
  resetBooks()
})
</script>

<template>
  <BottomSheet
    full-height
    compact
    :open="financialConsent.open"
    :title="financialConsent.title"
    @close="resolveFinancialConsent(false)"
  >
    <p class="eyebrow">
      {{ financialConsent.ledgerName }}
    </p>
    <ul class="consent-details">
      <li v-for="(line, index) in financialConsent.lines" :key="index">
        {{ line }}
      </li>
    </ul>
    <p class="muted">确认后保存到此账本并同步统计。拒绝后不会写入记录。</p>
    <template #footer>
      <button
        class="button button-secondary"
        @click="resolveFinancialConsent(false)"
      > 拒绝</button><button
        class="button button-primary"
        @click="resolveFinancialConsent(true)"
      >
        确认记录
      </button>
    </template>
  </BottomSheet>
  <ApplicationAuthorizationDialog />
  <Modal
    :open="!!invitation"
    title="加入共享账本"
    :busy="joining"
    @close="invitation = ''"
  >
    <p>加入后，你和对方将看到同一个账本。账本设有密码时，需要另行解锁。</p>
    <p
      v-if="inviteError"
      class="form-error"
      role="alert"
    >
      {{ inviteError }}
    </p>
    <footer class="dialog-footer">
      <button
        class="button button-secondary"
        :disabled="joining"
        @click="invitation = ''"
      > 取消</button><button
        class="button button-primary"
        :disabled="joining"
        @click="join"
      >
        {{ joining ? "正在加入…" : "接受邀请" }}
      </button>
    </footer>
  </Modal>
</template>
