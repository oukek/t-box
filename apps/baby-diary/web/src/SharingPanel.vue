<script setup lang="ts">
import type {
  BabyInvite,
  BabyMember,
  BabyRole,
  BabyScope,
} from '@t-box/baby-diary-contracts'
import { babyScopes } from '@t-box/baby-diary-contracts'
import { BottomSheet, Modal, SheetSelect } from '@t-box/ui-kit'
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  baby,
  base,
  errorText,
  invoke,
  onPrivateClear,
  runtime,
} from './runtime'

const emit = defineEmits<{ close: [], changed: [] }>()
const members = ref<BabyMember[]>([])
const invites = ref<BabyInvite[]>([])
const busy = ref(false)
const error = ref('')
const token = ref('')
const copied = ref(false)
const edit = ref<BabyMember>()
const inviting = ref(false)
const confirm = ref<{
  title: string
  message: string
  method: string
  args: unknown
}>()
const form = reactive<{
  role: Exclude<BabyRole, 'owner'>
  scopes: BabyScope[]
  allowExport: boolean
  days: number
  maxUses: number
}>({
  role: 'viewer',
  scopes: [...babyScopes],
  allowExport: false,
  days: 7,
  maxUses: 1,
})
const roles = [
  { value: 'viewer', label: '查看者', description: '仅浏览获授权范围内的内容' },
  {
    value: 'editor',
    label: '记录者',
    description: '可新建记录，修改和删除自己创建的内容',
  },
  { value: 'admin', label: '管理者', description: '可管理全部内容和普通成员' },
] as const
const roleName = (role: BabyRole) =>
  ({ owner: '所有者', admin: '管理者', editor: '记录者', viewer: '查看者' })[
    role
  ]
const scopeName = (value: BabyScope) =>
  ({ diary: '日记与里程碑', growth: '成长测量', creative: '创意影像', care: '日常照护' })[value]
let active = true
async function load() {
  try {
    const [m, i] = await Promise.all([
      invoke<BabyMember[]>('members_list', base()),
      invoke<BabyInvite[]>('invites_list', base()),
    ])
    if (active) {
      members.value = m
      invites.value = i
    }
  } catch (e) {
    error.value = errorText(e)
  }
}
function startInvite() {
  Object.assign(form, {
    role: 'viewer',
    scopes: [...babyScopes],
    allowExport: false,
    days: 7,
    maxUses: 1,
  })
  edit.value = undefined
  inviting.value = true
  token.value = ''
  error.value = ''
}
function startEdit(member: BabyMember) {
  Object.assign(form, {
    role: member.role,
    scopes: [...member.scopes],
    allowExport: member.allowExport,
  })
  edit.value = member
  inviting.value = true
  error.value = ''
}
async function save() {
  busy.value = true
  error.value = ''
  if (form.role === 'admin') {
    form.scopes = [...babyScopes]
    form.allowExport = true
  }
  try {
    if (edit.value) {
      await invoke('members_update', {
        ...base(),
        subject: edit.value.subject,
        role: form.role,
        scopes: [...form.scopes],
        allowExport: form.allowExport,
      })
    } else {
      const result = await invoke<{ invite: BabyInvite, token: string | null }>(
        'invites_create',
        { ...base(), ...form, scopes: [...form.scopes] },
      )
      token.value = result.token || ''
      if (!result.token) {
        error.value = '邀请已创建，但邀请码只展示一次。请撤销后重新生成。'
      }
      copied.value = false
    }
    inviting.value = false
    await load()
    emit('changed')
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function execute() {
  if (!confirm.value) {
    return
  }
  busy.value = true
  try {
    await invoke(confirm.value.method, confirm.value.args)
    confirm.value = undefined
    await load()
    emit('changed')
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(token.value)
    copied.value = true
  } catch {
    error.value = '浏览器未允许复制，请长按选中邀请码复制'
  }
}
onMounted(() => {
  void load()
})
const stop = onPrivateClear(() => {
  active = false
  token.value = ''
  members.value = []
  invites.value = []
  emit('close')
})
onBeforeUnmount(() => {
  active = false
  stop()
})
</script>

<template>
  <BottomSheet
    open
    full-height
    title="一起记录成长"
    :busy="busy"
    @close="emit('close')"
  >
    <div class="sharing-panel">
      <p class="subtle">
        {{ baby?.name }}的档案 · 每个宝宝独立授权，邀请不会开放其他宝宝。
      </p>
      <div v-if="token" class="invite-result">
        <strong>邀请码已生成</strong>
        <p>
          只发送给你信任的家人。对方在宝宝日记中选择「加入档案」，输入此码。
        </p>
        <input
          :value="token"
          readonly
          aria-label="新生成的邀请码"
          @focus="($event.target as HTMLInputElement).select()"
        ><button class="secondary small" @click="copy">
          {{ copied ? "已复制" : "复制邀请码" }}
        </button>
      </div>
      <p
        v-if="error && !inviting"
        class="error"
        role="alert"
      >{{ error }}</p>
      <div class="section-heading">
        <h3>
          档案成员 <small>{{ members.length }}</small>
        </h3>
        <button
          class="primary small"
          :disabled="baby?.archived"
          @click="startInvite"
        >
          邀请家人
        </button>
      </div>
      <div class="member-list">
        <article
          v-for="member in members"
          :key="member.subject"
          class="member-row"
        >
          <span class="member-avatar">{{
            member.displayName.slice(0, 1)
          }}</span>
          <div>
            <strong>{{ member.displayName
            }}<small v-if="member.subject === runtime.subject">（你）</small></strong>
            <p>{{ roleName(member.role) }}</p>
            <small>{{
              member.role === "owner" || member.role === "admin"
                ? "全部内容"
                : member.scopes.map(scopeName).join(" · ")
            }}{{
              member.allowExport
                || member.role === "owner"
                || member.role === "admin"
                ? " · 可下载原文件"
                : ""
            }}</small>
          </div>
          <div
            v-if="
              member.role !== 'owner'
                && member.subject !== runtime.subject
                && (baby?.role === 'owner' || member.role !== 'admin')
            "
            class="member-actions"
          >
            <button
              class="text-button"
              :disabled="baby?.archived"
              @click="startEdit(member)"
            >
              权限</button><button
              class="text-button muted"
              :disabled="baby?.archived"
              @click="
                confirm = {
                  title: '移除成员？',
                  message: `${member.displayName}将不能继续访问此宝宝的记录。已经下载的文件无法撤回。`,
                  method: 'members_remove',
                  args: { ...base(), subject: member.subject },
                }
              "
            >
              移除</button><button
              v-if="baby?.role === 'owner'"
              class="text-button muted"
              :disabled="baby?.archived"
              @click="
                confirm = {
                  title: '转让档案所有权？',
                  message: `档案将归${member.displayName}所有，你将成为管理者，不能自行收回所有权。`,
                  method: 'members_transfer',
                  args: { ...base(), subject: member.subject },
                }
              "
            >
              转让
            </button>
          </div>
        </article>
      </div>
      <div class="section-heading">
        <h3>邀请记录</h3>
        <small class="subtle">邀请码仅在创建时展示</small>
      </div>
      <div v-if="!invites.length" class="subtle">还没有邀请记录。</div>
      <div
        v-for="invite in invites"
        :key="invite.id"
        class="invite-row"
      >
        <div>
          <strong>{{ roleName(invite.role) }}</strong><small>{{ new Date(invite.expiresAt).toLocaleDateString() }} 到期 ·
            {{ invite.uses }}/{{ invite.maxUses }} 次使用</small>
        </div>
        <span v-if="invite.revoked" class="subtle">已撤销</span><span
          v-else-if="Date.parse(invite.expiresAt) <= Date.now()"
          class="subtle"
        >已过期</span><button
          v-else
          class="text-button muted"
          :disabled="busy || baby?.archived"
          @click="
            confirm = {
              title: '撤销邀请？',
              message:
                '撤销后，此邀请码不能再用于加入档案，已加入的成员不受影响。',
              method: 'invites_revoke',
              args: { ...base(), inviteId: invite.id },
            }
          "
        >
          撤销
        </button>
      </div>
      <p class="footnote">
        移除或收回权限后，后续访问会被阻止。对方已经查看、截图或下载的内容无法远程撤回。
      </p>
    </div>
  </BottomSheet>
  <Modal
    :open="inviting"
    :title="edit ? '成员权限' : '邀请家人'"
    :busy="busy"
    @close="inviting = false"
  ><form
     id="baby-sharing-form"
     class="form-stack"
     @submit.prevent="save"
   >
     <label>成员角色<SheetSelect
       v-model="form.role"
       label="成员角色"
       :options="
         roles.filter(
           (row) => baby?.role === 'owner' || row.value !== 'admin',
         )
       "
     /></label>
     <fieldset v-if="form.role !== 'admin'">
       <legend>可访问内容（至少一项）</legend>
       <label
         v-for="value in babyScopes"
         :key="value"
         class="check-row"
       ><input
         v-model="form.scopes"
         type="checkbox"
         :value="value"
       >{{
         scopeName(value)
       }}</label>
     </fieldset>
     <label
       v-if="form.role !== 'admin'"
       class="check-row"
     ><input
       v-model="form.allowExport"
       type="checkbox"
     >允许下载原图和附件</label>
     <p v-else class="subtle">管理者拥有全部内容与原文件访问权限。</p>
     <div v-if="!edit" class="two-columns">
       <label>有效天数<input
         v-model.number="form.days"
         type="number"
         min="1"
         max="30"
         required
       ></label><label>最多加入人数<input
         v-model.number="form.maxUses"
         type="number"
         min="1"
         max="100"
         required
       ></label>
     </div>
     <p
       v-if="error"
       class="error"
       role="alert"
     >{{ error }}</p>
   </form>
    <template #footer><button
      class="primary"
      form="baby-sharing-form"
      :disabled="busy || !form.scopes.length"
    >
      {{ edit ? "保存权限" : "生成邀请码" }}
    </button></template></Modal>
  <Modal
    :open="!!confirm"
    :title="confirm?.title || ''"
    :busy="busy"
    @close="confirm = undefined"
  ><p>{{ confirm?.message }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <template #footer><button
      class="secondary"
      :disabled="busy"
      @click="confirm = undefined"
    >
      取消</button><button
      class="danger"
      :disabled="busy"
      @click="execute"
    >
      确认
    </button></template></Modal>
</template>
