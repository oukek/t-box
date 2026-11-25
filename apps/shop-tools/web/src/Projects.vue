<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'

import type { ProjectInvite, ProjectMember, ProjectRole, ProjectSummary } from '@t-box/shop-tools-contracts'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { computed, onMounted, ref } from 'vue'
import App from './App.vue'
import EditDialog from './EditDialog.vue'

const props = defineProps<{ client: AppClient }>()
const projects = ref<ProjectSummary[]>([])
const current = ref<ProjectSummary>()
const workspace = ref<InstanceType<typeof App>>()
defineExpose({ beforeSystemUpdate: async () => {
  if (document.querySelector('dialog[open] :is(input, textarea, [contenteditable=true])')) {
    return false
  }
  return !workspace.value || await workspace.value.flushProject()
} })
const opened = ref(false)
const managing = ref<ProjectSummary>()
const form = ref('')
const busy = ref(false)
const error = ref('')
const name = ref('')
const code = ref('')
const issued = ref('')
const days = ref(1)
const maxUses = ref(1)
const role = ref<ProjectRole>('viewer')
const members = ref<ProjectMember[]>([])
const invites = ref<ProjectInvite[]>([])
const target = ref<ProjectMember>()
const labels = { owner: '所有者', admin: '管理员', editor: '可编辑', viewer: '只读' }
const canManage = computed(() => managing.value && ['owner', 'admin'].includes(managing.value.role))
const options = computed(() => (['viewer', 'editor', ...(managing.value?.role === 'owner' ? ['admin'] : [])] as ProjectRole[]).map((value) => ({ value, label: labels[value] })))
function call<T>(action: string, args: Record<string, unknown> = {}) {
  return props.client.api.invoke<T>('projects', { action, ...args })
}
async function run(fn: () => Promise<void>) {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
async function list() {
  projects.value = await call<ProjectSummary[]>('list')
  current.value = projects.value.find((p) => p.id === current.value?.id) ?? projects.value[0]
}
async function show() {
  await run(async () => {
    opened.value = true
    if (workspace.value && !await workspace.value.flushProject()) {
      throw new Error('当前修改尚未保存，请返回工作簿处理后再切换项目')
    }
    await list()
  })
}
async function select(id: string) {
  if (workspace.value && !await workspace.value.flushProject()) {
    throw new Error('当前修改尚未保存')
  }
  current.value = projects.value.find((p) => p.id === id)
  opened.value = false
}
async function details(project: ProjectSummary) {
  const data = await call<{ members: ProjectMember[], invites: ProjectInvite[] }>('members', { projectId: project.id })
  managing.value = project
  members.value = data.members
  invites.value = data.invites
}
function edit(mode: string, member?: ProjectMember) {
  error.value = ''
  target.value = member
  role.value = member?.role ?? 'viewer'
  name.value = mode === 'rename' ? managing.value?.name ?? '' : ''
  days.value = 1
  maxUses.value = 1
  code.value = ''
  issued.value = ''
  form.value = mode
}
const titles: Record<string, string> = { create: '新建项目', join: '加入项目', rename: '修改项目名称', invite: '邀请成员', role: '修改成员权限', remove: '移除成员', leave: '退出项目' }
async function submit() {
  await run(async () => {
    const action = form.value
    if (action === 'create' || action === 'join') {
      const { id } = await call<{ id: string }>(action, { name: name.value.trim(), code: code.value.trim() })
      await list()
      await select(id)
    } else if (action === 'leave') {
      await call('leave', { projectId: managing.value!.id })
      managing.value = undefined
      await list()
    } else {
      const project = managing.value!
      const result = await call<{ code?: string }>(action, { projectId: project.id, name: name.value, role: role.value, days: days.value, maxUses: maxUses.value, subject: target.value?.subject })
      if (result.code) {
        issued.value = result.code
      }
      await list()
      await details(projects.value.find((p) => p.id === project.id)!)
    }
    form.value = ''
  })
}
onMounted(() => run(list))
</script>

<template>
  <App
    v-if="current"
    :key="current.id"
    ref="workspace"
    :client="client"
    :project="current"
    @projects="show"
  />
  <main v-else class="panel"><p>{{ error || '正在读取项目…' }}</p><button v-if="error" @click="run(list)">重试</button></main>
  <Modal
    :open="opened"
    title="项目管理"
    :busy="busy"
    @close="opened = false"
  >
    <div class="shop-dialog-body">
      <p v-if="error && !form && !managing" role="alert">{{ error }}</p>
      <div class="toolbar"><button @click="edit('create')">新建项目</button><button @click="edit('join')">用邀请码加入</button></div>
      <div
        v-for="p in projects"
        :key="p.id"
        class="site-row"
      ><div><strong>{{ p.name }}</strong><small>{{ labels[p.role] }}{{ current?.id === p.id ? ' · 当前项目' : '' }}</small></div>
        <div class="actions"><button :disabled="busy" @click="run(() => details(p))">成员与共享</button><button :disabled="busy" @click="run(() => select(p.id))">进入</button></div>
      </div>
    </div>
  </Modal>
  <Modal
    :open="!!managing"
    :title="(managing?.name || '') + ' · 成员与共享'"
    :busy="busy"
    @close="managing = undefined; issued = ''"
  >
    <div class="shop-dialog-body">
      <p v-if="error && !form" role="alert">{{ error }}</p>
      <div v-if="canManage" class="toolbar"><button @click="edit('invite')">生成邀请</button><button @click="edit('rename')">修改项目名称</button></div>
      <button v-if="managing && managing.role !== 'owner'" @click="edit('leave')">退出项目</button>
      <label v-if="issued" class="field">复制邀请码给对方<FormControl
        readonly
        :value="issued"
        @focus="($event.target as HTMLInputElement).select()"
      /></label>
      <div
        v-for="m in members"
        :key="m.subject"
        class="site-row"
      ><div>{{ m.name }}<small>{{ labels[m.role] }} · {{ m.subject.slice(-6) }}</small></div>
        <div v-if="canManage && options.some(o => o.value === m.role)" class="actions"><button @click="edit('role', m)">改权限</button><button @click="edit('remove', m)">移除</button></div>
      </div>
      <div
        v-for="i in invites"
        :key="i.id"
        class="site-row"
      ><span>{{ labels[i.role] }}邀请 · 剩余 {{ i.remaining }} 次 · {{ new Date(i.expiresAt).toLocaleDateString() }} 到期</span><button
        v-if="options.some(o => o.value === i.role)"
        :disabled="busy"
        @click="run(async () => { await call('revoke', { projectId: managing!.id, id: i.id }); issued = ''; await details(managing!) })"
      >撤销</button></div>
    </div>
  </Modal>
  <EditDialog
    :open="!!form"
    :title="titles[form] || ''"
    :busy="busy"
    @save="submit"
    @close="form = ''"
  >
    <p v-if="error" role="alert">{{ error }}</p>
    <label v-if="form === 'join'" class="field">邀请码<FormControl v-model="code" /></label>
    <label v-if="['join', 'rename', 'create'].includes(form)" class="field">{{ form === 'join' ? '在项目中显示的姓名' : '项目名称' }}<FormControl v-model="name" maxlength="80" /></label>
    <SheetSelect
      v-if="form === 'invite' || form === 'role'"
      v-model="role"
      label="成员权限"
      desktop-modal
      :options="options"
    />
    <div v-if="form === 'invite'" class="fields two-columns">
      <label class="field">有效天数<FormControl
        v-model.number="days"
        type="number"
        min="1"
        max="7"
      /></label>
      <label class="field">可加入人数<FormControl
        v-model.number="maxUses"
        type="number"
        min="1"
        max="20"
      /></label>
    </div>
    <p v-if="form === 'leave'">退出后需要重新获邀才能访问此项目。</p>
    <p v-if="form === 'remove'">移除 {{ target?.name }} 后，对方将失去该项目的访问权限。</p>
  </EditDialog>
</template>
