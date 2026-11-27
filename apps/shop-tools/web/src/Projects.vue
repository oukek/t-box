<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'

import type { CreativeTemplate, ProjectInvite, ProjectMember, ProjectRole, ProjectSummary } from '@t-box/shop-tools-contracts'
import { projectSites } from '@t-box/shop-tools-contracts'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { computed, onMounted, ref } from 'vue'
import App from './App.vue'
import Catalog from './Catalog.vue'
import Collection from './Collection.vue'
import CreativeStudio from './CreativeStudio.vue'
import EditDialog from './EditDialog.vue'

const props = defineProps<{ client: AppClient, showCreative: boolean }>()
const projects = ref<ProjectSummary[]>([])
const loadingProjects = ref(false)
let projectListRequest = 0
const current = ref<ProjectSummary>()
const workspace = ref<InstanceType<typeof App>>()
defineExpose({ beforeSystemUpdate: async () => {
  if (document.querySelector('dialog[open] :is(input, textarea, [contenteditable=true])')) {
    return false
  }
  return !workspace.value || await workspace.value.flushProject()
} })
const error = ref('')
const section = ref('projects')
const projectTab = ref('products')
const site = ref('MY')
const templates = ref<CreativeTemplate[]>([])
const templatesLoaded = ref(false)
async function goBack() {
  if (workspace.value && !await workspace.value.flushProject()) {
    error.value = '计价表尚未保存，请先处理保存错误'
    return
  }
  await props.client.navigation.back()
}
async function navigate(next: string) {
  if (workspace.value && !await workspace.value.flushProject()) {
    error.value = '计价表尚未保存，暂不能切换'
    return
  }
  section.value = next
  current.value = undefined
  if (next === 'assistant' && !templatesLoaded.value) {
    await loadTemplates()
  }
}
async function projectSection(next: string) {
  if (workspace.value && !await workspace.value.flushProject()) {
    error.value = '计价表尚未保存'
    return
  }
  projectTab.value = next
}
const managing = ref<ProjectSummary>()
const form = ref('')
const busy = ref(false)
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
  const request = ++projectListRequest
  loadingProjects.value = true
  try {
    const rows = await props.client.api.invoke<ProjectSummary[]>('projects', { action: 'list' }, { timeoutMs: 8000 })
    if (request !== projectListRequest) {
      return
    }
    projects.value = rows
    current.value = projects.value.find((p) => p.id === current.value?.id)
  } finally {
    if (request === projectListRequest) {
      loadingProjects.value = false
    }
  }
}
async function select(id: string) {
  if (workspace.value && !await workspace.value.flushProject()) {
    throw new Error('当前修改尚未保存')
  }
  current.value = projects.value.find((p) => p.id === id)
  projectTab.value = 'products'
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
  site.value = managing.value?.site || 'MY'
  form.value = mode
}
const titles: Record<string, string> = { create: '新建项目', join: '加入项目', rename: '项目设置', invite: '邀请成员', role: '修改成员权限', remove: '移除成员', leave: '退出项目' }
async function submit() {
  await run(async () => {
    const action = form.value
    if (action === 'create' || action === 'join') {
      const { id } = await call<{ id: string }>(action, { name: name.value.trim(), code: code.value.trim(), site: site.value })
      await list()
      await select(id)
    } else if (action === 'leave') {
      await call('leave', { projectId: managing.value!.id })
      managing.value = undefined
      await list()
    } else {
      const project = managing.value!
      const result = await call<{ code?: string }>(action, { projectId: project.id, name: name.value, site: site.value, role: role.value, days: days.value, maxUses: maxUses.value, subject: target.value?.subject })
      if (result.code) {
        issued.value = result.code
      }
      await list()
      await details(projects.value.find((p) => p.id === project.id)!)
    }
    form.value = ''
  })
}
async function saveTemplates(value: CreativeTemplate[]) {
  await run(async () => {
    if (!templatesLoaded.value) {
      throw new Error('模板尚未读取，请重新打开小助手后再保存。')
    }
    await props.client.api.invoke('catalog', { action: 'save-templates', templates: value })
    templates.value = value
  })
}
onMounted(() => {
  void list().catch(() => {
    error.value = '项目列表暂时无法连接，请检查网络后刷新。'
  })
})
async function loadTemplates() {
  await props.client.api.invoke<CreativeTemplate[]>('catalog', { action: 'templates' }).then((value) => {
    templates.value = value
    templatesLoaded.value = true
  })
}
</script>

<template>
  <div class="shop-app shop-projects">
    <ApplicationHeader
      application-root
      title="电商助手"
      back-label="OS"
      @back="run(goBack)"
    />
    <nav class="catalog-navigation" aria-label="应用分区">
      <button
        :aria-current="section === 'projects' ? 'page' : undefined"
        :class="{ selected: section === 'projects' }"
        @click="run(() => navigate('projects'))"
      >项目管理</button>
      <button
        :aria-current="section === 'collection' ? 'page' : undefined"
        :class="{ selected: section === 'collection' }"
        @click="run(() => navigate('collection'))"
      >个人采集表</button>
      <button
        v-if="showCreative"
        :aria-current="section === 'assistant' ? 'page' : undefined"
        :class="{ selected: section === 'assistant' }"
        @click="run(() => navigate('assistant'))"
      >小助手</button>
    </nav>
    <p
      v-if="error && !form && !managing"
      class="notice error"
      role="alert"
    >{{ error }}</p>
    <CreativeStudio
      v-if="section === 'assistant'"
      :client="client"
      :templates="templates"
      temporary
      visible
      @templates="saveTemplates"
    />
    <Collection v-else-if="section === 'collection'" :client="client" />
    <template v-else-if="current">
      <div class="project-context"><button @click="run(() => navigate('projects'))">← 项目列表</button><strong>{{ current.name }}</strong><span>{{ projectSites.find(s => s.value === current?.site)?.label || '站点待设置' }}</span><button @click="run(() => details(current!))">项目设置与成员</button></div>
      <nav class="project-tabs"><button :class="{ selected: projectTab === 'products' }" @click="run(() => projectSection('products'))">项目商品</button><button :class="{ selected: projectTab === 'pricing' }" @click="run(() => projectSection('pricing'))">计价表</button></nav>
      <Catalog
        v-if="projectTab === 'products'"
        :key="current.id + current.site"
        :client="client"
        :project="current"
        :show-creative="showCreative"
      />
      <App
        v-else
        :key="current.id"
        ref="workspace"
        :client="client"
        :project="current"
        :show-creative="false"
        embedded
        @projects="run(() => navigate('projects'))"
      />
    </template>
    <main v-else class="shop-content"><section class="panel project-list">
      <div class="project-actions"><button class="primary" @click="edit('create')">新建项目</button><button @click="edit('join')">用邀请码加入</button><button :disabled="busy" @click="run(list)">刷新</button></div>
      <div
        v-if="loadingProjects && !projects.length"
        class="project-loading"
        role="status"
        aria-label="正在加载项目列表"
      >
        <i v-for="row in 3" :key="row" />
      </div>
      <p v-if="!loadingProjects && !projects.length && !error" class="muted">还没有项目，可以新建项目或用邀请码加入。</p>
      <div
        v-for="p in projects"
        :key="p.id"
        class="site-row"
      ><div><strong>{{ p.name }}</strong><small>{{ projectSites.find(s => s.value === p.site)?.label || '尚未设置国家站点' }} · {{ labels[p.role] }}</small></div><div class="actions"><button :disabled="busy" @click="run(() => details(p))">设置与成员</button><button :disabled="busy" @click="run(() => select(p.id))">进入项目</button></div></div>
    </section></main>
  </div>
  <Modal
    :open="!!managing"
    :title="(managing?.name || '') + ' · 成员与共享'"
    :busy="busy"
    @close="managing = undefined; issued = ''"
  >
    <div class="shop-dialog-body">
      <p v-if="error && !form" role="alert">{{ error }}</p>
      <div v-if="canManage" class="toolbar"><button @click="edit('invite')">生成邀请</button><button @click="edit('rename')">项目设置</button></div>
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
    <SheetSelect
      v-if="form === 'create' || form === 'rename'"
      v-model="site"
      label="国家 / 站点"
      desktop-modal
      :options="projectSites.map(s => ({ value: s.value, label: s.label }))"
    />
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

<style scoped>
.project-loading {
  display: grid;
  gap: 12px;
  padding: 18px 2px;
}
.project-loading i {
  display: block;
  width: min(68%, 320px);
  height: 11px;
  border-radius: 4px;
  background: #e7eaf0;
}
.project-loading i:nth-child(2) {
  width: min(48%, 220px);
}
</style>
