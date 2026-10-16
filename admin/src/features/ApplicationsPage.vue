<script setup lang="ts">
import type {
  ApplicationPublicationEvent,
  ManagedApplication,
  ManagedRelease,
} from '@t-box/app-contracts'
import { validApplicationIcon } from '@t-box/app-contracts'
import { presentApplicationIcon } from '@t-box/shared'
import LauncherIcon from '@t-box/ui-kit/LauncherIcon.vue'
import { computed, onMounted, reactive, ref } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request, save } from '../core/api'

interface Artifact {
  digest: string
  fileCount: number
  bytes: number
}
const applications = ref<ManagedApplication[]>([])
const selectedId = ref('')
const query = ref('')
const error = ref('')
const notice = ref('')
const loading = ref(true)
const busy = ref(false)
const dialogError = ref('')
const editorOpen = ref(false)
const editing = ref<ManagedRelease | null>(null)
const newApp = ref(false)
const artifacts = ref<Artifact[]>([])
const artifactOrigin = ref('')
const artifactDelivery = ref('local')
const historyOpen = ref(false)
const events = ref<ApplicationPublicationEvent[]>([])
const transition = ref<{
  entry: ManagedRelease
  action: 'submit' | 'publish'
  expected: string | null
} | null>(null)
const form = reactive({
  appId: '',
  kind: 'user',
  version: '1.0.0',
  name: '',
  description: '',
  icon: 'apps',
  iconAsset: '',
  iconVariant: 'image' as 'image' | 'calendar' | 'clock',
  color: 'blue',
  releaseNotes: '',
  updatePrompt: { mode: 'default' as 'default' | 'custom', title: '', description: '', confirmText: '', deferText: '' },
  artifact: '',
  runtime: 'web',
  revision: 1,
})
const iconOf = (entry?: ManagedRelease) => presentApplicationIcon({ id: entry?.release.appId || '', icon: entry?.release.manifest.icon || 'apps', iconAsset: entry?.release.manifest.iconAsset, iconVariant: entry?.release.manifest.iconVariant })
async function uploadIcon(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  dialogError.value = ''
  try {
    if (file.size > 128 * 1024) {
      throw new Error('图标最大 128 KB')
    }
    const extension = file.name.split('.').pop()?.toLowerCase()
    const mime = ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[extension || '']
    if (!mime) {
      throw new Error('请选择 PNG、JPEG、WebP、GIF 或 SVG 图标')
    }
    const data = `data:${mime};base64,${btoa(Array.from(new Uint8Array(await file.arrayBuffer()), (b) => String.fromCharCode(b)).join(''))}`
    if (!validApplicationIcon(data)) {
      throw new Error('图标格式无效；SVG 仅支持静态矢量图形')
    }
    form.iconAsset = data
    form.iconVariant = 'image'
  } catch (e) {
    dialogError.value = errorMessage(e)
  }
}
const current = computed(() =>
  applications.value.find((a) => a.appId === selectedId.value),
)
const filtered = computed(() =>
  applications.value.filter((a) =>
    (a.appId + ' ' + a.releases[0]?.release.manifest.name)
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
)
const online = computed(() =>
  current.value?.releases.find((r) => r.status === 'published'),
)
const statusNames = {
  draft: '草稿',
  submitted: '待发布',
  published: '线上版本',
  retired: '历史版本',
}
const canUpload = computed(() => /^[a-z][a-z0-9_-]{0,63}$/.test(form.appId))
const artifactOptions = computed(() =>
  artifacts.value.map((a) => ({
    value: a.digest,
    label: `${a.digest.slice(0, 12)} · ${a.fileCount} 个文件`,
    description: `${(a.bytes / 1024).toFixed(1)} KB`,
  })),
)
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await request<{
      applications: ManagedApplication[]
      artifactOrigin: string
      artifactDelivery?: string
    }>('/applications')
    applications.value = result.applications
    artifactOrigin.value = result.artifactOrigin
    artifactDelivery.value = result.artifactDelivery || 'local'
    if (!current.value) {
      selectedId.value = applications.value[0]?.appId || ''
    }
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
async function loadArtifacts() {
  artifacts.value = []
  if (!canUpload.value) {
    return
  }
  try {
    artifacts.value = await request(`/applications/${form.appId}/artifacts`)
  } catch (e) {
    dialogError.value = errorMessage(e)
  }
}
function nextVersion(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : ''
}
async function edit(entry?: ManagedRelease, createApplication = false) {
  newApp.value = createApplication
  editing.value = entry || null
  dialogError.value = ''
  const base = entry || online.value || current.value?.releases[0]
  const r = createApplication ? undefined : base?.release
  const appearance = r ? presentApplicationIcon(r.manifest) : undefined
  Object.assign(form, {
    appId: r?.appId || '',
    kind: createApplication ? 'user' : current.value?.kind || 'user',
    version: entry
      ? r?.manifest.version
      : r
        ? nextVersion(r.manifest.version)
        : '1.0.0',
    name: r?.manifest.name || '',
    description: r?.manifest.description || '',
    icon: r?.manifest.icon || 'apps',
    iconAsset: appearance?.iconAsset || '',
    iconVariant: appearance?.iconVariant || 'image',
    color: r?.manifest.color || 'blue',
    releaseNotes: entry?.releaseNotes || '',
    updatePrompt: { mode: 'default', title: '', description: '', confirmText: '', deferText: '', ...r?.updatePrompt },
    artifact: r?.runtime.type === 'web' ? r.runtime.integrity.slice(7) : '',
    runtime: r?.runtime.type || 'web',
    revision: entry?.revision || 1,
  })
  editorOpen.value = true
  await loadArtifacts()
}
async function upload(event: Event) {
  const element = event.target as HTMLInputElement
  const files = Array.from(element.files || [])
  if (!files.length) {
    return
  }
  busy.value = true
  dialogError.value = ''
  try {
    if (
      files.length > 2000 ||
      files.some((f) => f.size > 5 * 1024 * 1024) ||
      files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024
    ) {
      throw new Error('最多 2000 个文件，单文件 5 MB，完整应用 20 MB')
    }
    const data = []
    for (const file of files) {
      const relative = file.webkitRelativePath || file.name
      const path = file.webkitRelativePath
        ? relative.slice(relative.indexOf('/') + 1)
        : relative
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('读取构建文件失败'))
        reader.readAsDataURL(file)
      })
      data.push({ path, content })
    }
    const artifact = await save<Artifact>(
      `/applications/${form.appId}/artifacts`,
      { files: data },
    )
    await loadArtifacts()
    form.artifact = artifact.digest
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
    element.value = ''
  }
}
async function submitDraft() {
  busy.value = true
  dialogError.value = ''
  try {
    await save(
      editing.value
        ? `/application-releases/${editing.value.release.releaseId}`
        : '/application-releases',
      { ...form },
      editing.value ? 'PATCH' : 'POST',
    )
    selectedId.value = form.appId
    editorOpen.value = false
    notice.value = '版本草稿已保存，提交后可发布'
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
function prepare(entry: ManagedRelease, action: 'submit' | 'publish') {
  dialogError.value = ''
  transition.value = {
    entry,
    action,
    expected: current.value?.currentReleaseId || null,
  }
}
async function execute() {
  if (!transition.value) {
    return
  }
  busy.value = true
  dialogError.value = ''
  try {
    const t = transition.value
    await save(
      `/application-releases/${t.entry.release.releaseId}/transitions`,
      {
        action: t.action,
        revision: t.entry.revision,
        expectedCurrentReleaseId: t.expected,
      },
    )
    notice.value =
      t.action === 'publish'
        ? '版本已发布，用户可在应用市场更新'
        : '版本已提交，内容已锁定'
    transition.value = null
    await load()
  } catch (e) {
    dialogError.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
async function showHistory() {
  if (!current.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    events.value = await request(`/applications/${current.value.appId}/events`)
    historyOpen.value = true
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
const eventNames: Record<string, string> = {
  create_draft: '创建草稿',
  edit_draft: '修改草稿',
  submit: '提交版本',
  publish: '发布版本',
  migrate_runtime: '迁移为独立应用',
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">应用 / 发布管理</p>
      <h1>应用版本</h1>
      <p>提交构建产物，检查版本，再发布到应用市场。</p>
    </div>
    <button
      class="primary"
      :disabled="busy || loading"
      @click="edit(undefined, true)"
    >
      <AdminIcon name="plus" :size="16" />添加应用
    </button>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }} <button @click="load">重试</button>
  </p>
  <p
    v-if="notice"
    class="success"
    role="status"
  >
    {{ notice }}
  </p>
  <div class="publication-workspace">
    <aside class="panel application-catalog">
      <div class="search-field">
        <AdminIcon name="search" :size="16" /><input
          v-model="query"
          placeholder="搜索应用"
          aria-label="搜索应用"
        >
      </div>
      <p v-if="loading" class="empty">正在读取版本…</p>
      <p v-else-if="!filtered.length" class="empty">没有匹配的应用</p>
      <button
        v-for="item in filtered"
        :key="item.appId"
        class="application-choice"
        :class="{ selected: item.appId === selectedId }"
        :aria-pressed="item.appId === selectedId"
        @click="selectedId = item.appId"
      >
        <LauncherIcon
          class="catalog-icon"
          :icon="item.releases[0]?.release.manifest.icon || 'apps'"
          :icon-asset="iconOf(item.releases[0]).iconAsset"
          :icon-variant="iconOf(item.releases[0]).iconVariant"
          :animate="false"
        /><span><strong>{{
          item.releases[0]?.release.manifest.name || item.appId
        }}</strong><small>{{
          item.kind === "system" ? "系统应用 · 不可卸载" : "用户应用 · 可卸载"
        }}</small></span>
      </button>
    </aside>
    <section v-if="current" class="panel release-panel">
      <header class="release-heading">
        <div>
          <h2>
            {{
              online?.release.manifest.name
                || current.releases[0]?.release.manifest.name
            }}
          </h2>
          <span class="release-identity">{{ current.appId }}</span>
        </div>
        <div class="release-actions">
          <button :disabled="busy" @click="showHistory">发布记录</button><button
            class="primary"
            :disabled="busy"
            @click="edit()"
          >
            <AdminIcon name="plus" :size="15" />新增版本
          </button>
        </div>
      </header>
      <div class="live-release">
        <span class="live-dot" /><span>当前线上</span><strong>{{
          online ? "v" + online.release.manifest.version : "尚未发布"
        }}</strong><span class="live-time">{{
          online
            ? date(online.publishedAt)
            : "保存草稿并提交后，才会出现在用户市场"
        }}</span>
      </div>
      <div class="release-list">
        <article
          v-for="entry in current.releases"
          :key="entry.release.releaseId"
          class="release-row"
        >
          <div class="release-version">
            <LauncherIcon
              class="version-icon"
              :icon="entry.release.manifest.icon"
              :icon-asset="iconOf(entry).iconAsset"
              :icon-variant="iconOf(entry).iconVariant"
              :animate="false"
            /><strong>v{{ entry.release.manifest.version }}</strong><span class="publication-status" :class="entry.status">{{
              statusNames[entry.status]
            }}</span>
          </div>
          <p class="release-notes">
            {{ entry.releaseNotes || "未填写更新说明" }}
          </p>
          <div class="release-meta">
            <span>{{
              entry.release.runtime.type === "web"
                ? "独立 Web 应用"
                : "内置页面 · 随宿主发版"
            }}</span><span>{{ date(entry.createdAt) }}</span>
          </div>
          <p
            v-if="entry.status !== 'published'"
            class="readiness"
            :class="{ blocked: !entry.readiness.ready }"
          >
            <AdminIcon
              :name="entry.readiness.ready ? 'check' : 'lock'"
              :size="13"
            />{{ entry.readiness.reason }}
          </p>
          <div class="release-footer">
            <span
              v-if="entry.release.runtime.type === 'web'"
              class="artifact-digest"
              :title="entry.release.runtime.integrity"
            >{{ entry.release.runtime.integrity.slice(0, 23) }}…</span><span v-else class="artifact-digest">{{
              entry.release.releaseId
            }}</span>
            <div>
              <button
                v-if="entry.status === 'draft'"
                :disabled="busy"
                @click="edit(entry)"
              > 编辑草稿</button><button
                v-if="entry.status === 'draft'"
                :disabled="busy || !entry.readiness.ready"
                @click="prepare(entry, 'submit')"
              > 提交版本</button><button
                v-if="
                  entry.status === 'submitted' || entry.status === 'retired'
                "
                class="primary"
                :disabled="busy || !entry.readiness.ready"
                @click="prepare(entry, 'publish')"
              >
                {{ entry.status === "retired" ? "切换到此版本" : "发布" }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
  <p class="footnote">
    <AdminIcon
      name="lock"
      :size="14"
    />系统应用可以更新，不能卸载。发布保留旧版产物；用户更新后使用新版本，卸载记账不会删除账本数据。
  </p>
  <AdminDialog
    :open="editorOpen"
    :title="editing ? '编辑版本草稿' : newApp ? '添加应用' : '新增版本'"
    description="提交后内容锁定，修改需要创建新版本。"
    :busy="busy"
    @close="editorOpen = false"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <form
      id="release-form"
      class="dialog-form"
      @submit.prevent="submitDraft"
    >
      <fieldset :disabled="busy">
        <div class="form-grid">
          <label>应用标识<input
            v-model="form.appId"
            :disabled="!newApp"
            maxlength="64"
            pattern="[a-z][a-z0-9_\-]{0,63}"
            required
            placeholder="例如 notes"
            @change="loadArtifacts"
          ></label><label>版本号<input
            v-model="form.version"
            required
            maxlength="48"
            placeholder="1.0.0"
          ><small>使用三段版本号，例如 1.0.0、1.1.0。</small></label>
        </div>
        <label>应用名称<input
          v-model="form.name"
          maxlength="80"
          required
        ></label>
        <label>应用说明<textarea
          v-model="form.description"
          rows="2"
          maxlength="400"
          required
        />
        </label>
        <div class="form-grid">
          <label>应用类型<AdminSelect
            v-model="form.kind"
            label="应用类型"
            :disabled="!newApp"
            :options="[
              {
                value: 'user',
                label: '用户应用',
                description: '用户可以安装与卸载',
              },
              {
                value: 'system',
                label: '系统应用',
                description: '预装、不可卸载，支持更新',
              },
            ]"
          /></label>
        </div>
        <div class="application-icon-editor">
          <LauncherIcon
            :icon="form.icon"
            :icon-asset="form.iconAsset"
            :icon-variant="form.iconVariant"
            :animate="false"
          />
          <div><strong>应用图标</strong><p>随版本保存。构建提交会自动读取应用图标，也可在草稿中替换。</p>
            <label class="icon-upload">选择图片<input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
              aria-label="上传应用图标"
              @change="uploadIcon"
            ></label>
            <small>PNG / SVG / JPEG / WebP / GIF · 最大 128 KB，建议正方形</small>
          </div>
        </div>
        <label>更新说明<textarea
          v-model="form.releaseNotes"
          rows="3"
          maxlength="4000"
          placeholder="说明新增功能、修复内容和用户需要注意的变化"
        />
        </label>
        <label>应用内更新提示<AdminSelect
          v-model="form.updatePrompt.mode"
          label="应用内更新提示"
          :options="[{ value: 'default', label: '系统默认弹窗' }, { value: 'custom', label: '应用自定义弹窗（SDK）' }]"
        /></label>
        <p class="field-hint">此配置随版本安装后生效。自定义弹窗需要应用注册 SDK 处理器；缺失、异常或超时会使用系统提示。</p>
        <div class="form-grid">
          <label>弹窗标题<input
            v-model="form.updatePrompt.title"
            maxlength="60"
            placeholder="发现新版本"
          ></label>
          <label>确认按钮<input
            v-model="form.updatePrompt.confirmText"
            maxlength="24"
            placeholder="前往更新"
          ></label>
          <label>稍后按钮<input
            v-model="form.updatePrompt.deferText"
            maxlength="24"
            placeholder="稍后"
          ></label>
        </div>
        <label>提示说明<textarea
          v-model="form.updatePrompt.description"
          maxlength="400"
          rows="2"
          placeholder="新版本已上架，前往应用市场查看并更新。"
        /></label>
        <div v-if="form.runtime === 'web'" class="artifact-picker">
          <div class="artifact-label">
            <strong>构建产物</strong><label
              v-if="artifactDelivery !== 'oss'"
              class="upload-build"
              :class="{ disabled: !canUpload || busy }"
            ><AdminIcon name="plus" :size="14" />上传 dist 目录<input
              type="file"
              webkitdirectory
              multiple
              :disabled="!canUpload || busy"
              aria-label="上传构建目录"
              @change="upload"
            ></label>
          </div>
          <AdminSelect
            v-model="form.artifact"
            label="构建产物"
            :options="artifactOptions"
            :disabled="!canUpload"
            placeholder="选择已上传的构建产物"
            :empty-text="artifactDelivery === 'oss' ? '请先通过应用发布工作流上传构建' : '还没有构建产物，请上传 dist 目录'"
          /><small>应用使用相对资源路径（Vite base: './'）和应用
            SDK。上传不会自动上线。</small><small class="mono">产物服务：{{ artifactOrigin }}</small>
        </div>
        <p v-else class="shell-note">
          此应用当前随宿主构建。保存新版本草稿后，需要先部署对应版本的宿主和
          API，才能提交发布。
        </p>
      </fieldset>
    </form>
    <template #footer>
      <button :disabled="busy" @click="editorOpen = false">取消</button><button
        class="primary"
        form="release-form"
        type="submit"
        :disabled="busy || (form.runtime === 'web' && !form.artifact)"
      >
        {{ busy ? "正在保存…" : "保存草稿" }}
      </button>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="!!transition"
    :title="transition?.action === 'submit' ? '提交版本？' : '发布版本？'"
    :busy="busy"
    compact
    @close="transition = null"
  >
    <p
      v-if="dialogError"
      class="alert"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template v-if="transition">
      <p>
        <strong>{{ transition.entry.release.manifest.name }} · v{{
          transition.entry.release.manifest.version
        }}</strong>
      </p>
      <p class="muted">
        {{
          transition.action === "submit"
            ? "提交后版本内容将锁定，仍不会出现在用户市场。"
            : "发布后，应用市场将提供此版本。已有安装保留原版本，用户确认更新后切换。"
        }}
      </p>
      <p
        v-if="
          transition.action === 'publish'
            && transition.entry.status === 'retired'
        "
        class="alert"
      >
        你正在切换到历史版本，请确认其前后端仍能兼容。
      </p>
    </template>
    <template #footer>
      <button :disabled="busy" @click="transition = null">取消</button><button
        class="primary"
        :disabled="busy"
        @click="execute"
      >
        {{
          busy
            ? "正在处理…"
            : transition?.action === "submit"
              ? "确认提交"
              : "确认发布"
        }}
      </button>
    </template>
  </AdminDialog>
  <AdminDialog
    :open="historyOpen"
    title="发布记录"
    @close="historyOpen = false"
  >
    <p v-if="!events.length" class="muted">还没有后台发布操作。</p>
    <ol class="publication-events">
      <li v-for="event in events" :key="event.id">
        <strong>{{ eventNames[event.action] || event.action }}</strong><time>{{ date(event.createdAt) }}</time><small>{{ event.releaseId }} · {{ event.administratorId === '00000000-0000-0000-0000-000000000000' ? '系统迁移' : `管理员 ${event.administratorId.slice(0, 8)}` }}</small>
      </li>
    </ol>
  </AdminDialog>
</template>

<style scoped>
.catalog-icon {
  --icon-size: 38px;
}
.version-icon {
  --icon-size: 30px;
}
.application-icon-editor {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 14px;
  background: #f4f6fa;
  border-radius: 12px;
}
.application-icon-editor strong {
  font-size: 13px;
}
.application-icon-editor p,
.application-icon-editor small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
  margin: 4px 0 8px;
}
.icon-upload {
  display: inline-flex;
  position: relative;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}
.icon-upload input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
}

.publication-workspace {
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.application-catalog {
  padding: 12px;
  position: sticky;
  top: 84px;
}
.application-catalog .search-field {
  width: 100%;
  margin-bottom: 12px;
}
.application-choice {
  width: 100%;
  border-color: transparent;
  justify-content: flex-start;
  text-align: left;
  padding: 12px 8px;
  margin: 2px 0;
  gap: 10px;
}
.application-choice.selected {
  background: var(--accent-soft);
  border-color: #d5defd;
}
.application-choice strong {
  display: block;
  font-size: 14px;
}
.application-choice small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.release-heading {
  padding: 22px 24px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.release-heading h2 {
  font-size: 19px;
  margin: 0 0 5px;
}
.release-identity,
.artifact-digest {
  font:
    11px ui-monospace,
    SFMono-Regular,
    monospace;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.release-actions {
  display: flex;
  gap: 8px;
}
.live-release {
  margin: 0 24px;
  padding: 13px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: var(--muted);
}
.live-release strong {
  color: var(--ink);
  font:
    600 14px ui-monospace,
    SFMono-Regular,
    monospace;
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.live-time {
  margin-left: auto;
  font-size: 11px;
}
.release-row {
  padding: 22px 24px;
  border-bottom: 1px solid var(--line);
}
.release-row:last-child {
  border-bottom: 0;
}
.release-version {
  display: flex;
  align-items: center;
  gap: 12px;
}
.release-version strong {
  font:
    600 20px ui-monospace,
    SFMono-Regular,
    monospace;
  letter-spacing: -0.5px;
}
.publication-status {
  padding: 3px 7px;
  font-size: 11px;
  border-radius: 5px;
  color: var(--muted);
  background: #f0f2f6;
}
.publication-status.published {
  background: var(--accent-soft);
  color: var(--accent);
}
.publication-status.submitted {
  background: #fff4dc;
  color: #8b630b;
}
.release-notes {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.7;
  margin: 12px 0;
  color: var(--ink);
}
.release-meta {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: var(--muted);
}
.readiness {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #397852;
  font-size: 11px;
  margin: 12px 0 0;
}
.readiness.blocked {
  color: #98682f;
}
.release-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
  margin-top: 16px;
}
.release-footer > div {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.artifact-picker {
  display: grid;
  gap: 10px;
  border: 1px solid var(--line);
  padding: 14px;
  border-radius: 10px;
}
.artifact-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.artifact-label strong {
  font-size: 13px;
}
.upload-build {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
}
.upload-build.disabled {
  opacity: 0.45;
}
.upload-build input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
  padding: 0;
}
.artifact-picker small,
.shell-note {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
}
.publication-events {
  list-style: none;
  padding: 0;
  margin: 0;
}
.publication-events li {
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.publication-events strong {
  font-size: 13px;
}
.publication-events time {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.publication-events small {
  width: 100%;
  overflow-wrap: anywhere;
  color: var(--muted);
  font:
    11px ui-monospace,
    SFMono-Regular,
    monospace;
}
.dialog-form textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  resize: vertical;
  font: inherit;
  color: var(--ink);
  background: var(--surface);
}
.dialog-form textarea:focus {
  border-color: var(--focus-border);
  outline: none;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 1000px) {
  .publication-workspace {
    grid-template-columns: 190px minmax(0, 1fr);
    gap: 12px;
  }
  .live-time {
    display: none;
  }
  .release-heading,
  .release-row {
    padding-left: 16px;
    padding-right: 16px;
  }
  .release-heading {
    flex-wrap: wrap;
  }
  .live-release {
    margin: 0 16px;
  }
}
@media (max-width: 700px) {
  .publication-workspace {
    display: block;
  }
  .application-catalog {
    position: static;
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .application-catalog .search-field {
    flex: 1 0 100%;
  }
  .application-choice {
    width: auto;
    flex: 1 0 140px;
    padding: 8px;
  }
  .release-footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .release-meta {
    flex-wrap: wrap;
    gap: 6px 12px;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
