<script setup lang="ts">
import type { LedgerInput } from '@t-box/ledger-contracts'
import { AppIcon, BottomSheet, SheetSelect } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { computed, reactive, ref, watch } from 'vue'
import { requestApplicationAuthorization } from '../applicationAuthorization'
import LedgerPage from '../bills/LedgerPage.vue'
import LedgerTools from '../features/LedgerTools.vue'
import {
  backFromApplication,
  navigation,
  openApplication,
  tabLabel,
} from '../runtime'
import { booksApi } from './booksApi'
import BookSettings from './BookSettings.vue'
import { bookState, loadBooks, selectBook, selectedBook } from './bookStore'
import DebtsPanel from './DebtsPanel.vue'
import StatisticsPanel from './StatisticsPanel.vue'

const props = defineProps<{
  ledgerId?: string
  month?: string
  billId?: string
  openRevision?: number
}>()
const toolsRef = ref<InstanceType<typeof LedgerTools>>()
const bookId = ref(props.ledgerId || '')
const tab = ref<'records' | 'debts' | 'statistics' | 'settings' | 'tools'>(
  'records',
)
const modal = ref<'create' | 'join' | null>(null)
const busy = ref(false)
const error = ref('')
const password = ref('')
const accountPassword = ref('')
const nextPassword = ref('')
const resetVisible = ref(false)
const joinLink = ref('')
const form = reactive<LedgerInput>({ name: '', template: 'combined' })
const newPassword = ref('')
const book = computed(() =>
  bookState.books.find((row) => row.id === bookId.value),
)
const canWrite = computed(
  () =>
    !!book.value &&
    !book.value.archived &&
    book.value.role !== 'viewer' &&
    (!book.value.hasPassword || book.value.authorizationScope === 'write'),
)
const canManage = computed(
  () => book.value?.role === 'owner' || book.value?.role === 'admin',
)
const templateLabels = {
  daily: '日常收支',
  debt: '往来账本',
  combined: '综合账本',
}
const roles = {
  owner: '所有者',
  admin: '管理员',
  editor: '记账成员',
  viewer: '只读成员',
}
const headerDescription = computed(() => {
  if (!bookId.value) {
    return undefined
  }
  if (!book.value) {
    return undefined
  }
  const current = book.value
  return `${templateLabels[current.template]} · ${current.memberCount} 位成员 · ${roles[current.role]}${current.archived ? ' · 已归档' : ''}`
})
async function authorizeWrite() {
  const current = book.value
  if (!current) {
    return
  }
  await requestApplicationAuthorization({
    ledgerId: current.id,
    ledgerName: current.name,
    scope: 'write',
    purpose: '记账与管理账本',
  })
}
async function enter(id: string) {
  selectBook(id)
  bookId.value = id
  tab.value = book.value?.template === 'debt' ? 'debts' : 'records'
  password.value = ''
  error.value = ''
  await openApplication({ appId: 'ledger', params: { ledgerId: id } })
}
async function back() {
  if (tab.value === 'tools' && toolsRef.value?.hasSelection) {
    toolsRef.value.back()
    return
  }
  bookId.value = ''
  await loadBooks()
  await openApplication({ appId: 'ledger' })
}
function create() {
  form.name = ''
  form.template = 'combined'
  newPassword.value = ''
  error.value = ''
  modal.value = 'create'
}
async function submit() {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result =
      modal.value === 'create'
        ? await booksApi.create({
            ...form,
            ...(newPassword.value ? { password: newPassword.value } : {}),
          })
        : await booksApi.join(extractToken(joinLink.value))
    await loadBooks()
    modal.value = null
    await enter(result.data.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败'
  } finally {
    busy.value = false
  }
}
function extractToken(value: string) {
  const trimmed = value.trim()
  if (/^[a-f0-9]{64}$/.test(trimmed)) {
    return trimmed
  }
  const hash = trimmed.includes('#') ? trimmed.split('#')[1]! : trimmed
  return new URLSearchParams(hash.split('?')[1] || '').get('token') || ''
}
async function unlock() {
  if (!book.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await booksApi.unlock(book.value.id, password.value)
    password.value = ''
    await loadBooks()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '解锁失败'
  } finally {
    busy.value = false
  }
}
async function reset() {
  if (!book.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await booksApi.password(
      book.value.id,
      accountPassword.value,
      nextPassword.value || null,
    )
    accountPassword.value = ''
    nextPassword.value = ''
    resetVisible.value = false
    await loadBooks()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '重置失败'
  } finally {
    busy.value = false
  }
}
async function lock() {
  if (book.value) {
    await booksApi.lock(book.value.id)
    await loadBooks()
  }
}
watch(
  () => props.ledgerId,
  (id) => {
    bookId.value = id || ''
    if (id) {
      selectBook(id)
      if (book.value?.template === 'debt') {
        tab.value = 'debts'
      }
    }
    error.value = ''
    password.value = ''
    resetVisible.value = false
  },
)
watch(
  () => props.openRevision,
  () => {
    if (props.ledgerId && props.billId) {
      tab.value = 'records'
    }
  },
)
watch(
  () => bookState.selectedId,
  () => {
    if (
      bookId.value &&
      book.value?.template === 'debt' &&
      tab.value === 'records'
    ) {
      tab.value = 'debts'
    }
  },
)
void loadBooks()
</script>

<template>
  <section class="book-hub">
    <ApplicationHeader
      :title="bookId ? book?.name || '账本不可用' : '账本'"
      :back-label="
        tab === 'tools' && toolsRef?.hasSelection
          ? '账本管理'
          : bookId
            ? '全部账本'
            : tabLabel(navigation.backTo)
      "
      :description="headerDescription"
      @back="bookId ? back() : backFromApplication()"
    >
      <template v-if="!bookId || (book?.hasPassword && !book.locked)" #actions>
        <button
          v-if="book?.hasPassword && !book.locked"
          class="icon-button"
          aria-label="锁定账本"
          title="锁定账本"
          @click="lock"
        >
          <AppIcon name="lock" :size="18" />
        </button>
        <div v-if="!bookId" class="book-toolbar">
          <button
            class="button book-join-action"
            type="button"
            aria-label="加入账本"
            title="加入账本"
            @click="
              modal = 'join';
              joinLink = '';
              error = '';
            "
          >
            <AppIcon name="link" :size="16" />
            <span>加入账本</span>
          </button>
          <button
            class="button button-primary book-create-action"
            aria-label="创建账本"
            @click="create"
          >
            <AppIcon name="plus" :size="17" />新建
          </button>
        </div>
      </template>
    </ApplicationHeader>
    <template v-if="!bookId">
      <p
        v-if="bookState.error"
        class="form-error"
        role="alert"
      >
        {{ bookState.error }}
        <button class="text-button" @click="loadBooks">重试</button>
      </p>
      <p v-if="bookState.loading && !bookState.books.length">正在读取账本…</p>
      <div class="book-grid">
        <button
          v-for="item in bookState.books"
          :key="item.id"
          class="book-card"
          :class="{
            archived: item.archived,
            selected: item.id === selectedBook?.id,
          }"
          @click="enter(item.id)"
        >
          <span class="book-card-icon"><AppIcon
            :name="item.template === 'debt' ? 'exchange' : 'ledger'"
            :size="23"
          /></span>
          <span class="book-card-content">
            <span class="book-card-heading"><span class="book-card-name">{{ item.name }}</span><AppIcon
              v-if="item.hasPassword"
              name="lock"
              :size="13"
            /></span>
            <span class="book-card-kind">{{ templateLabels[item.template] }} ·
              {{
                item.memberCount > 1 ? `${item.memberCount} 人共享` : "个人账本"
              }}</span>
            <span class="book-card-status">{{ roles[item.role]
            }}<template v-if="item.archived"> · 已归档</template><template v-else-if="item.locked"> · 待解锁</template></span>
          </span>
          <AppIcon
            class="book-card-chevron"
            name="right"
            :size="18"
          />
        </button>
      </div>
      <div
        v-if="!bookState.loading && !bookState.books.length"
        class="book-empty"
      >
        还没有账本，创建一本或加入朋友的账本。
      </div>
    </template><template v-else-if="book">
      <div v-if="book.locked" class="book-lock">
        <span class="book-lock-symbol"><AppIcon name="lock" :size="26" /></span>
        <h2>解锁账本</h2>
        <p>你已是成员。解锁后查看记录和统计。</p>
        <form v-if="!resetVisible" @submit.prevent="unlock">
          <label class="form-field">账本密码<input
            v-model="password"
            type="password"
            autocomplete="off"
            required
            maxlength="128"
          ></label><button class="button button-primary" :disabled="busy">
            {{ busy ? "正在解锁…" : "解锁账本" }}
          </button>
        </form>
        <form v-else @submit.prevent="reset">
          <label class="form-field">你的账号密码<input
            v-model="accountPassword"
            type="password"
            autocomplete="current-password"
            required
            maxlength="128"
          ></label><label class="form-field">新账本密码<input
            v-model="nextPassword"
            type="password"
            autocomplete="new-password"
            minlength="6"
            maxlength="128"
            placeholder="留空可关闭账本密码"
          ></label><button class="button button-primary" :disabled="busy">
            重置账本密码
          </button>
        </form>
        <p
          v-if="error"
          class="form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <button
          v-if="book.role === 'owner'"
          class="text-button"
          @click="
            resetVisible = !resetVisible;
            error = '';
          "
        >
          {{ resetVisible ? "返回解锁" : "忘记密码？所有者可重置" }}
        </button>
      </div>
      <template v-else>
        <div
          v-if="
            book.hasPassword
              && book.authorizationScope === 'read'
              && book.role !== 'viewer'
          "
          class="book-read-grant"
        >
          <span>当前仅授权查看此账本</span><button class="text-button" @click="authorizeWrite">授权写入</button>
        </div>
        <nav class="book-tabs" aria-label="账本功能">
          <button
            v-if="book.template !== 'debt'"
            :class="{ active: tab === 'records' }"
            @click="tab = 'records'"
          > 收支记录</button><button
            v-if="book.template !== 'daily'"
            :class="{ active: tab === 'debts' }"
            @click="tab = 'debts'"
          > 往来</button><button
            :class="{ active: tab === 'statistics' }"
            @click="tab = 'statistics'"
          > 统计</button><button
            :class="{ active: tab === 'settings' }"
            @click="tab = 'settings'"
          > 设置 / 共享</button><button :class="{ active: tab === 'tools' }" @click="tab = 'tools'">
            管理
          </button>
        </nav>
        <LedgerTools
          v-if="tab === 'tools'"
          ref="toolsRef"
          :key="book.id"
          :ledger-id="book.id"
          :can-write="canWrite"
          :can-manage="canManage"
          :template="book.template"
        />
        <LedgerPage
          v-if="tab === 'records' && book.template !== 'debt'"
          :key="book.id"
          :ledger-id="book.id"
          :can-write="canWrite"
          :can-manage="canManage"
          :month="month"
          :bill-id="billId"
          :open-revision="openRevision"
        /><DebtsPanel
          v-if="tab === 'debts' && book.template !== 'daily'"
          :key="book.id"
          :ledger-id="book.id"
          :can-write="canWrite"
          :can-manage="canManage"
        /><StatisticsPanel
          v-if="tab === 'statistics'"
          :key="book.id"
          :ledger-id="book.id"
          :debt-enabled="book.template !== 'daily'"
        /><BookSettings
          v-if="
            tab === 'settings'
              && !(
                book.hasPassword
                && book.authorizationScope === 'read'
                && book.role !== 'viewer'
              )
          "
          :key="book.id"
          :book="book"
          @left="back"
          @locked="loadBooks"
        />
      </template>
    </template>
    <div v-else class="book-empty">
      <p>账本不存在或你已不再是成员。</p>
    </div>
  </section>
  <BottomSheet
    :open="modal !== null"
    :title="modal === 'create' ? '创建账本' : '加入账本'"
    :busy="busy"
    :full-height="modal !== 'join'"
    compact
    @close="modal = null"
  >
    <form id="ledger-book-form" @submit.prevent="submit">
      <fieldset class="form-fields" :disabled="busy">
        <legend class="sr-only">账本信息</legend>
        <template v-if="modal === 'create'">
          <label class="form-field">账本名称<input
            v-model="form.name"
            required
            maxlength="40"
            placeholder="例如：家庭日常、朋友往来"
          ></label><label class="form-field">账本类型<SheetSelect
            v-model="form.template"
            label="选择账本类型"
            :disabled="busy"
            :options="[
              {
                value: 'combined',
                label: '综合账本',
                description: '收入、支出与应收应付',
              },
              {
                value: 'daily',
                label: '日常账本',
                description: '记录收入与支出',
              },
              {
                value: 'debt',
                label: '往来账本',
                description: '管理应收、应付和收还款',
              },
            ]"
          /></label><label class="form-field">账本密码（选填）<input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="6"
            maxlength="128"
            placeholder="至少 6 个字符"
          ></label>
          <p class="muted">
            收入和支出分类会复制一份默认分类到此账本，之后可自行添加。
          </p>
        </template><label
          v-else
          class="form-field"
        >邀请链接或邀请码<input
          v-model="joinLink"
          required
          placeholder="粘贴朋友分享的邀请链接"
        ></label>
      </fieldset>
      <p
        v-if="error"
        class="form-error"
        role="alert"
      >
        {{ error }}
      </p>
    </form>
    <template #footer>
      <button
        type="button"
        class="button button-secondary"
        :disabled="busy"
        @click="modal = null"
      > 取消</button><button
        class="button button-primary"
        :disabled="busy"
        type="submit"
        form="ledger-book-form"
      >
        {{ busy ? "正在处理…" : modal === "create" ? "创建账本" : "加入账本" }}
      </button>
    </template>
  </BottomSheet>
</template>
