<script setup lang="ts">
import type { Administrator } from '@t-box/shared'
import { onMounted, reactive, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminInput from '../components/AdminInput.vue'
import { errorMessage, request, save } from '../core/api'
import { administrator } from '../core/session'

const users = ref<Administrator[]>([])
const error = ref('')
const dialogError = ref('')
const notice = ref('')
const busy = ref(false)
const loading = ref(true)
const editor = ref<'create' | 'password' | null>(null)
const toggling = ref<Administrator | null>(null)
const create = reactive({ username: '', password: '' })
const change = reactive({ currentPassword: '', newPassword: '' })
async function load() {
  loading.value = true
  try {
    users.value = await request('/users')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
function openEditor(kind: 'create' | 'password') {
  create.username = ''
  create.password = ''
  change.currentPassword = ''
  change.newPassword = ''
  dialogError.value = ''
  editor.value = kind
}
function closeEditor() {
  if (busy.value) {
    return
  }
  editor.value = null
  create.password = ''
  change.currentPassword = ''
  change.newPassword = ''
}
async function add() {
  busy.value = true
  dialogError.value = ''
  notice.value = ''
  try {
    await save('/users', create)
    create.username = ''
    create.password = ''
    editor.value = null
    notice.value = '管理员已添加'
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
async function toggle() {
  const user = toggling.value
  if (!user) {
    return
  }
  busy.value = true
  dialogError.value = ''
  notice.value = ''
  try {
    await save(`/users/${user.id}`, { enabled: !user.enabled }, 'PATCH')
    toggling.value = null
    notice.value = `管理员已${user.enabled ? '停用' : '启用'}`
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
async function updatePassword() {
  busy.value = true
  dialogError.value = ''
  try {
    await save('/password', change, 'PATCH')
    change.currentPassword = ''
    change.newPassword = ''
    editor.value = null
    administrator.value = null
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">工作台 / 访问管理</p>
      <h1>管理员账号</h1>
      <p>管理后台访问权限，账号与应用用户独立。</p>
    </div>
    <AdminButton
      class="primary"
      :disabled="busy || loading"
      @click="openEditor('create')"
    >
      <AdminIcon name="plus" :size="16" />添加管理员
    </AdminButton>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
  <p
    v-if="notice"
    class="success"
    role="status"
  >
    {{ notice }}
  </p>
  <section class="panel">
    <div class="panel-heading">
      <h2>
        账号列表<span class="count">{{ users.length }}</span>
      </h2>
      <span class="muted">所有管理员具有配置管理权限</span>
    </div>
    <div v-if="loading" class="empty">正在读取管理员…</div>
    <div v-else-if="!users.length" class="empty">暂无管理员账号。</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>管理员</th>
            <th>创建时间</th>
            <th>状态</th>
            <th class="actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>
              <div class="cell-identity">
                <span class="row-avatar" aria-hidden="true">{{
                  u.username[0]?.toUpperCase()
                }}</span><strong>{{ u.username }}</strong><span
                  v-if="u.id === administrator?.id"
                  class="current-label"
                >当前账号</span>
              </div>
            </td>
            <td class="mono">
              {{ u.createdAt.slice(0, 10) }}
            </td>
            <td>
              <span class="badge" :class="{ disabled: !u.enabled }">{{
                u.enabled ? "已启用" : "已停用"
              }}</span>
            </td>
            <td class="actions">
              <AdminButton
                :disabled="busy || u.id === administrator?.id"
                :class="{ 'danger-link': u.enabled }"
                @click="
                  toggling = u;
                  dialogError = '';
                "
              >
                {{ u.enabled ? "停用" : "启用" }}
              </AdminButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <section class="account-security">
    <span class="capability-icon"><AdminIcon name="lock" :size="21" /></span>
    <div>
      <h2>我的账号安全</h2>
      <p>修改密码后，当前账号的所有登录会话会立即失效。</p>
    </div>
    <AdminButton :disabled="busy" @click="openEditor('password')">
      修改我的密码<AdminIcon name="arrow" :size="15" />
    </AdminButton>
  </section>
  <AdminDialog
    :open="editor === 'create'"
    title="添加管理员"
    description="新账号可管理服务商、模型及其他管理员。"
    :busy="busy"
    @close="closeEditor"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <form
      id="admin-create-form"
      class="dialog-form"
      @submit.prevent="add"
    >
      <fieldset :disabled="busy">
        <label>登录账号<AdminInput
          v-model="create.username"
          required
          pattern="[A-Za-z0-9_.\-]{3,64}"
          maxlength="64"
          autocomplete="off"
          placeholder="3–64 位字母、数字或 _ . -"
        /></label><label>初始密码<AdminInput
          v-model="create.password"
          type="password"
          required
          minlength="6"
          maxlength="128"
          autocomplete="new-password"
          placeholder="至少 6 个字符"
        /><small>请通过安全渠道交给账号使用者。</small></label>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="closeEditor">取消</AdminButton><AdminButton
        form="admin-create-form"
        type="submit"
        class="primary"
        :disabled="busy"
      >
        {{ busy ? "正在添加…" : "添加管理员" }}
      </AdminButton>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="editor === 'password'"
    title="修改我的密码"
    description="保存后需重新登录，其他设备也会退出当前账号。"
    :busy="busy"
    @close="closeEditor"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <form
      id="admin-password-form"
      class="dialog-form"
      @submit.prevent="updatePassword"
    >
      <fieldset :disabled="busy">
        <label>当前密码<AdminInput
          v-model="change.currentPassword"
          type="password"
          required
          maxlength="128"
          autocomplete="current-password"
        /></label><label>新密码<AdminInput
          v-model="change.newPassword"
          type="password"
          required
          minlength="6"
          maxlength="128"
          autocomplete="new-password"
          placeholder="至少 6 个字符"
        /></label>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="closeEditor">取消</AdminButton><AdminButton
        form="admin-password-form"
        type="submit"
        class="primary"
        :disabled="busy"
      >
        {{ busy ? "正在更新…" : "更新密码并退出" }}
      </AdminButton>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="!!toggling"
    :title="`${toggling?.enabled ? '停用' : '启用'}管理员？`"
    :description="`账号：${toggling?.username || ''}。${toggling?.enabled ? '停用会立即撤销其登录会话。' : '启用后可重新登录工作台。'}`"
    :busy="busy"
    compact
    @close="toggling = null"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template #footer>
      <AdminButton :disabled="busy" @click="toggling = null">取消</AdminButton><AdminButton
        :class="toggling?.enabled ? 'danger' : 'primary'"
        :disabled="busy"
        @click="toggle"
      >
        {{ busy ? "正在处理…" : "确认" }}
      </AdminButton>
    </template>
  </AdminDialog>
</template>
