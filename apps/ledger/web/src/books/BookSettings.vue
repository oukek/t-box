<script setup lang="ts">
import type {
  Ledger,
  LedgerInvite,
  LedgerMember,
} from '@t-box/ledger-contracts'
import { AppIcon, BottomSheet, Modal, SheetSelect } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { identity, runtime } from '../runtime'
import { booksApi } from './booksApi'
import { bookState, loadBooks } from './bookStore'
import { formatTimestamp } from './format'

const props = defineProps<{ book: Ledger }>()
const emit = defineEmits<{ left: [], locked: [] }>()
const members = ref<LedgerMember[]>([])
const invites = ref<LedgerInvite[]>([])
const history = ref<
  { id: string, action: string, actor: string | null, createdAt: string }[]
>([])
const name = ref(props.book.name)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const accountPassword = ref('')
const bookPassword = ref('')
const link = ref('')
const invite = reactive({ role: 'editor', days: 1, maxUses: 1 })
const confirmation = ref('')
const editor = ref<'name' | 'invite' | 'password' | 'member' | null>(null)
const memberTarget = ref('')
const loading = ref(true)
const managedMember = computed(() =>
  members.value.find((member) => member.userId === memberTarget.value),
)
const canManage = computed(
  () => props.book.role === 'owner' || props.book.role === 'admin',
)
const readOnlyGrant = computed(
  () => props.book.hasPassword && props.book.authorizationScope !== 'write',
)
const roleOptions = computed(() => [
  {
    value: 'editor',
    label: '记账成员',
    description: '新增记录，修正自己的记录',
  },
  { value: 'viewer', label: '只读成员', description: '查看记录和统计' },
  ...(props.book.role === 'owner'
    ? [
        {
          value: 'admin',
          label: '管理员',
          description: '管理成员，修正所有记录',
        },
      ]
    : []),
])
function manageMember(member: LedgerMember) {
  memberTarget.value = member.userId
  error.value = ''
  editor.value = 'member'
}
function memberEditable(member: LedgerMember) {
  return (
    canManage.value &&
    member.userId !== identity.user?.id &&
    member.role !== 'owner' &&
    (props.book.role === 'owner' || member.role !== 'admin')
  )
}
function openEditor(next: 'name' | 'invite' | 'password') {
  error.value = ''
  notice.value = ''
  if (next === 'name') {
    name.value = props.book.name
  }
  if (next === 'invite') {
    link.value = ''
  }
  if (next === 'password') {
    accountPassword.value = ''
    bookPassword.value = ''
  }
  editor.value = next
}
function closeEditor() {
  editor.value = null
  accountPassword.value = ''
  bookPassword.value = ''
}
function inviteStatus(item: LedgerInvite) {
  return item.revoked
    ? '已撤销'
    : new Date(item.expiresAt).getTime() <= Date.now()
      ? '已过期'
      : item.uses >= item.maxUses
        ? '已用完'
        : '有效'
}
let action: (() => Promise<unknown>) | undefined
let generation = 0
let disposed = false
let passwordUpdating = false
const roles: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '记账成员',
  viewer: '只读成员',
}
const actionLabels: Record<string, string> = {
  'ledger.created': '创建账本',
  'ledger.updated': '修改账本',
  'ledger.password_changed': '修改账本密码',
  'ledger.transferred': '转让账本',
  'bill.created': '新增收支',
  'bill.updated': '修改收支',
  'bill.deleted': '删除收支',
  'category.created': '创建分类',
  'debt.created': '新增往来',
  'settlement.created': '登记收还款',
  'settlement.reversed': '撤销收还款',
  'member.joined': '成员加入',
  'member.role_changed': '修改成员角色',
  'member.removed': '移除成员',
  'member.left': '成员退出',
  'invite.created': '创建邀请',
  'invite.revoked': '撤销邀请',
  'statistics.rebuilt': '重建统计',
}
async function load() {
  if (disposed || passwordUpdating || props.book.locked) {
    return
  }
  const current = ++generation
  loading.value = true
  try {
    const [a, b, c] = await Promise.all([
      booksApi.members(props.book.id),
      props.book.role === 'owner' || props.book.role === 'admin'
        ? booksApi.invites(props.book.id)
        : Promise.resolve({ data: [] }),
      booksApi.history(props.book.id),
    ])
    if (current !== generation) {
      return
    }
    members.value = a.data
    invites.value = b.data
    history.value = c.data
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : '读取失败'
    }
  } finally {
    if (current === generation) {
      loading.value = false
    }
  }
}
async function run(work: () => Promise<unknown>, message = '已保存') {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
    notice.value = message
    await loadBooks()
    if (!props.book.locked) {
      await load()
    }
    return true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败'
    return false
  } finally {
    busy.value = false
  }
}
function ask(message: string, work: () => Promise<unknown>) {
  error.value = ''
  confirmation.value = message
  action = work
}
async function confirm() {
  if (action) {
    if (await run(action)) {
      confirmation.value = ''
      action = undefined
      if (editor.value === 'member' && !managedMember.value) {
        editor.value = null
      }
    }
  }
}
async function makeInvite() {
  await run(async () => {
    const result = await booksApi.invite(props.book.id, invite)
    link.value = /^https?:/.test(runtime.hostUrl) ? `${runtime.hostUrl}#/join?token=${result.data.token}` : result.data.token
  }, '邀请已生成，仅此处展示完整链接')
}
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value)
    notice.value = '邀请链接已复制'
  } catch {
    notice.value = '请选中邀请链接手动复制'
  }
}
async function applyPassword(remove = false) {
  passwordUpdating = true
  generation++
  try {
    await booksApi.password(
      props.book.id,
      accountPassword.value,
      remove ? null : bookPassword.value,
    )
    closeEditor()
    await loadBooks()
    emit('locked')
  } finally {
    passwordUpdating = false
  }
}
async function setPassword() {
  await run(() => applyPassword(), '密码已更新，成员需要重新解锁')
}
function changeRole(member: LedgerMember, role: string) {
  void run(
    () => booksApi.role(props.book.id, member.userId, role),
    '成员权限已更新',
  )
}
async function rename() {
  if (
    await run(
      () => booksApi.update(props.book.id, { name: name.value }),
      '名称已更新',
    )
  ) {
    editor.value = null
  }
}
function archive() {
  ask(
    props.book.archived
      ? '恢复这个账本的记录功能？'
      : '归档后账本保留所有记录，但不能新增或修改财务记录。',
    () => booksApi.update(props.book.id, { archived: !props.book.archived }),
  )
}
function revoke(item: LedgerInvite) {
  void run(() => booksApi.revoke(props.book.id, item.id), '邀请已撤销')
}
function remove(member: LedgerMember) {
  ask(`移除 ${member.nickname}？对方已有记录会保留，但不能继续访问账本。`, () =>
    booksApi.remove(props.book.id, member.userId))
}
function transfer(member: LedgerMember) {
  ask(`将账本所有权转让给 ${member.nickname}？你将成为管理员。`, () =>
    booksApi.transfer(props.book.id, member.userId))
}
function rebuild() {
  ask('从原始事件重新生成此账本的统计汇总？记录与往来余额不会被删除。', () =>
    booksApi.rebuild(props.book.id))
}
function leave() {
  ask('退出此账本？你的已有记录仍会保留。', async () => {
    await booksApi.remove(props.book.id, identity.user!.id)
    emit('left')
  })
}

watch(
  () => [invite.role, invite.days, invite.maxUses],
  () => {
    link.value = ''
    notice.value = ''
  },
)
watch([() => props.book.id, () => bookState.revision], load, {
  immediate: true,
})
onBeforeUnmount(() => {
  disposed = true
  generation++
})
</script>

<template>
  <section class="ledger-settings">
    <p
      v-if="error && !editor && !confirmation"
      class="form-error"
      role="alert"
    >
      {{ error }}<button class="text-button" @click="load">重试</button>
    </p>
    <p
      v-if="notice"
      role="status"
      class="settings-notice"
    >
      {{ notice }}
    </p>
    <section class="settings-card">
      <header class="settings-card-heading">
        <h2>账本信息</h2>
        <span class="settings-role">{{ roles[book.role] }}</span>
      </header>
      <button
        v-if="book.role === 'owner'"
        class="settings-row"
        :disabled="busy || readOnlyGrant"
        @click="openEditor('name')"
      >
        <span>账本名称</span><strong>{{ book.name }}</strong><AppIcon name="right" :size="16" />
      </button>
      <div v-else class="settings-row">
        <span>账本名称</span><strong>{{ book.name }}</strong>
      </div>
      <div class="settings-row">
        <span>类型</span><strong>{{
          book.template === "daily"
            ? "日常收支"
            : book.template === "debt"
              ? "往来账本"
              : "综合账本"
        }}
          · 人民币</strong>
      </div>
      <div v-if="book.archived" class="settings-row">
        <span>状态</span><strong>已归档</strong>
      </div>
    </section>
    <section class="settings-card">
      <header class="settings-card-heading">
        <h2>
          成员与共享<span>{{ book.memberCount }}</span>
        </h2>
        <button
          v-if="canManage"
          type="button"
          class="settings-invite-button"
          :disabled="busy || book.archived || readOnlyGrant"
          @click="openEditor('invite')"
        >
          <AppIcon name="share" :size="16" />邀请加入
        </button>
      </header>
      <p
        v-if="loading"
        class="settings-caption"
        role="status"
      >正在读取成员…</p>
      <div v-else class="settings-members">
        <article
          v-for="member in members"
          :key="member.userId"
          class="settings-member"
        >
          <span class="settings-avatar">{{ [...member.nickname][0] }}</span>
          <div>
            <strong>{{ member.nickname
            }}<small v-if="member.userId === identity.user?.id">你</small></strong><span>{{ roles[member.role] }}</span>
          </div>
          <button
            v-if="
              memberEditable(member)
                || (book.role === 'owner' && member.userId !== identity.user?.id)
            "
            class="icon-button"
            :aria-label="`管理成员 ${member.nickname}`"
            :disabled="busy || readOnlyGrant"
            @click="manageMember(member)"
          >
            <AppIcon name="settings" :size="18" />
          </button>
        </article>
      </div>
      <p class="settings-caption">
        所有成员使用同一份记录，往来方向以账本为主体。
      </p>
      <details v-if="canManage && invites.length" class="settings-invites">
        <summary>
          邀请记录 <span>{{ invites.length }} 条</span><AppIcon name="down" :size="15" />
        </summary>
        <article
          v-for="item in invites"
          :key="item.id"
          class="settings-invite-row"
        >
          <div>
            <strong>{{ roles[item.role]
            }}<small>{{ inviteStatus(item) }}</small></strong><span>{{ item.uses }} / {{ item.maxUses }} 人 · 到期
              {{ formatTimestamp(item.expiresAt) }}</span>
          </div>
          <button
            v-if="inviteStatus(item) === '有效'"
            class="text-button"
            :disabled="busy || readOnlyGrant"
            @click="revoke(item)"
          >
            撤销
          </button>
        </article>
      </details>
    </section>
    <section class="settings-card">
      <header class="settings-card-heading">
        <h2>安全</h2>
      </header>
      <button
        v-if="book.role === 'owner'"
        class="settings-row"
        :disabled="busy || readOnlyGrant"
        @click="openEditor('password')"
      >
        <span class="settings-row-icon"><AppIcon name="lock" :size="17" />账本密码</span><strong>{{ book.hasPassword ? "已开启" : "未设置" }}</strong><AppIcon name="right" :size="16" />
      </button>
      <div v-else class="settings-row">
        <span>账本密码</span><strong>{{ book.hasPassword ? "已开启" : "未设置" }}</strong>
      </div>
      <p class="settings-caption">
        解锁有效期 10 分钟；修改密码后成员需要重新解锁。
      </p>
    </section>
    <details class="settings-card settings-audit">
      <summary>最近操作<AppIcon name="down" :size="16" /></summary>
      <ol>
        <li v-for="row in history" :key="row.id">
          <span>{{ row.actor || "历史记录" }} ·
            {{ actionLabels[row.action] || row.action }}</span><time>{{ formatTimestamp(row.createdAt) }}</time>
        </li>
      </ol>
      <p v-if="!history.length" class="settings-caption">暂无操作记录。</p>
    </details>
    <details v-if="canManage" class="settings-card settings-maintenance">
      <summary>账本管理<AppIcon name="down" :size="16" /></summary>
      <button
        v-if="book.role === 'owner'"
        class="settings-row"
        :disabled="busy || readOnlyGrant"
        @click="archive"
      >
        <span>{{ book.archived ? "恢复账本" : "归档账本" }}</span><AppIcon name="right" :size="16" />
      </button>
      <p v-if="book.role === 'owner'" class="settings-caption">
        归档保留全部记录，暂停新增与修改。
      </p>
      <button
        class="settings-row"
        :disabled="busy || readOnlyGrant"
        @click="rebuild"
      >
        <span>校验并重建统计</span><AppIcon name="right" :size="16" />
      </button>
      <p class="settings-caption">从原始记录重新汇总，账单与往来余额会保留。</p>
    </details>
    <button
      v-if="book.role !== 'owner'"
      class="settings-leave"
      :disabled="busy || readOnlyGrant"
      @click="leave"
    >
      退出账本
    </button>
  </section>
  <BottomSheet
    :open="!!editor"
    :title="
      editor === 'name'
        ? '修改账本名称'
        : editor === 'invite'
          ? '邀请加入账本'
          : editor === 'password'
            ? '账本密码'
            : `管理 ${managedMember?.nickname || '成员'}`
    "
    :busy="busy"
    :full-height="editor === 'invite' || editor === 'password'"
    compact
    @close="closeEditor"
  >
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }}
    </p>
    <form
      v-if="editor === 'name'"
      id="book-name-form"
      @submit.prevent="rename"
    >
      <label class="form-field">账本名称<input
        v-model="name"
        required
        maxlength="40"
        :disabled="busy"
      ></label>
    </form>
    <template v-else-if="editor === 'invite'">
      <form id="book-invite-form" @submit.prevent="makeInvite">
        <fieldset class="form-fields" :disabled="busy">
          <legend class="sr-only">邀请选项</legend>
          <label class="form-field">成员权限<SheetSelect
            v-model="invite.role"
            label="选择邀请成员权限"
            :options="roleOptions"
            :disabled="busy"
          /></label>
          <div class="settings-invite-limits">
            <label class="form-field">有效期<SheetSelect
              v-model="invite.days"
              label="选择邀请有效期"
              :options="[
                { value: 1, label: '1 天' },
                { value: 3, label: '3 天' },
                { value: 7, label: '7 天' },
              ]"
              :disabled="busy"
            /></label><label class="form-field">加入人数<input
              v-model.number="invite.maxUses"
              type="number"
              min="1"
              max="20"
              required
            ></label>
          </div>
        </fieldset>
      </form>
      <p class="settings-caption">
        对方登录后即可加入；有密码的账本仍需单独解锁。
      </p>
      <div v-if="link" class="settings-share-link">
        <label class="form-field">邀请链接<input
          :value="link"
          readonly
          @focus="($event.target as HTMLInputElement).select()"
        ></label><button
          type="button"
          class="button button-secondary"
          @click="copy"
        >
          <AppIcon name="share" :size="16" />复制邀请链接
        </button>
        <p class="settings-caption">完整链接仅在生成后展示，请妥善分享。</p>
      </div>
      <p
        v-if="notice"
        role="status"
        class="settings-caption"
      >
        {{ notice }}
      </p>
    </template>
    <template v-else-if="editor === 'password'">
      <form id="book-password-form" @submit.prevent="setPassword()">
        <input
          class="sr-only"
          :value="identity.user?.username"
          autocomplete="username"
          readonly
          tabindex="-1"
          aria-label="账号"
        >
        <fieldset class="form-fields" :disabled="busy">
          <legend class="sr-only">密码设置</legend>
          <label class="form-field">你的账号密码<input
            v-model="accountPassword"
            type="password"
            autocomplete="current-password"
            required
            maxlength="128"
          ></label><label class="form-field">新账本密码<input
            v-model="bookPassword"
            type="password"
            autocomplete="new-password"
            minlength="6"
            maxlength="128"
            required
            placeholder="至少 6 个字符"
          ></label>
        </fieldset>
      </form>
      <p class="settings-caption">
        密码用于访问保护；修改后所有成员需重新解锁。
      </p>
      <button
        v-if="book.hasPassword"
        type="button"
        class="text-button danger-text"
        :disabled="busy || !accountPassword"
        @click="
          ask('关闭账本密码后，成员无需密码即可访问。确认关闭？', () =>
            applyPassword(true),
          )
        "
      >
        关闭账本密码
      </button>
    </template>
    <template v-else-if="editor === 'member' && managedMember">
      <div class="settings-managed-member">
        <span class="settings-avatar">{{
          [...managedMember.nickname][0]
        }}</span>
        <div>
          <strong>{{ managedMember.nickname }}</strong>
          <p>@{{ managedMember.username }}</p>
        </div>
      </div>
      <label
        v-if="memberEditable(managedMember)"
        class="form-field"
      >成员权限<SheetSelect
        :model-value="managedMember.role"
        label="选择成员权限"
        :options="roleOptions"
        :disabled="busy"
        @update:model-value="changeRole(managedMember, $event)"
      /></label>
      <p v-else class="settings-caption">
        {{ roles[managedMember.role] }}
      </p>
    </template>
    <template #footer>
      <template v-if="editor !== 'member'">
        <button
          type="button"
          class="button button-secondary"
          :disabled="busy"
          @click="closeEditor"
        >
          {{ editor === "invite" && link ? "完成" : "取消" }}
        </button><button
          :form="
            editor === 'name'
              ? 'book-name-form'
              : editor === 'invite'
                ? 'book-invite-form'
                : 'book-password-form'
          "
          class="button button-primary"
          :disabled="busy || (editor === 'name' && !name.trim())"
        >
          {{
            busy
              ? "正在保存…"
              : editor === "name"
                ? "保存名称"
                : editor === "invite"
                  ? "生成邀请"
                  : "保存密码"
          }}
        </button>
      </template><template v-else-if="managedMember">
        <div class="settings-member-actions">
          <button
            v-if="book.role === 'owner'"
            type="button"
            class="button button-secondary"
            :disabled="busy"
            @click="transfer(managedMember)"
          > 转让所有权</button><button
            v-if="memberEditable(managedMember)"
            type="button"
            class="button button-secondary danger-text"
            :disabled="busy"
            @click="remove(managedMember)"
          >
            移除成员
          </button>
        </div>
      </template>
    </template>
  </BottomSheet>
  <Modal
    :open="!!confirmation"
    title="确认操作"
    :busy="busy"
    @close="confirmation = ''"
  >
    <p class="muted">
      {{ confirmation }}
    </p>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }}
    </p>
    <footer class="dialog-footer">
      <button
        class="button button-secondary"
        :disabled="busy"
        @click="confirmation = ''"
      > 取消</button><button
        class="button button-primary"
        :disabled="busy"
        @click="confirm"
      >
        {{ busy ? "正在处理…" : "确认" }}
      </button>
    </footer>
  </Modal>
</template>
