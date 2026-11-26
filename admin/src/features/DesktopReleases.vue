<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import { apiBase, errorMessage, request, requestBlob } from '../core/api'
import SystemReleaseNotes from './SystemReleaseNotes.vue'

interface Row {
  build: string
  base: string | null
  kind: 'core' | 'ui' | 'both'
  state: 'pending' | 'live' | 'archived'
  notes: string
  ui: { version: string }
  core: { version: string }
  createdAt: string
}
const kinds = { core: '仅核心', ui: '仅界面', both: '联合更新' }
const states = { pending: '待确认', live: '当前生效', archived: '历史版本' }
const data = ref<{ current: Row | null, candidates: Row[] }>()
const selected = ref<Row>()
const notes = ref('')
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    data.value = await request('/desktop-releases')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
const downloading = ref('')
async function downloadTrial(row: Row) {
  downloading.value = row.build
  error.value = ''
  try {
    if (row.kind === 'ui') {
      const blob = await requestBlob('/desktop-releases/' + row.build + '/ui-trial', { signal: AbortSignal.timeout(180000) })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `Tbox-trial-core-${row.core.version}-ui-${row.ui.version}-${row.build.slice(0, 8)}.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60000)
      notice.value = '请先退出方舟，解压后双击「启动体验版.command」。'
      return
    }
    const { url } = await request<{ url: string }>('/desktop-releases/' + row.build + '/trial')
    window.location.assign(url)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    downloading.value = ''
  }
}
function review(row: Row) {
  notes.value = [row.notes, '优化修复 bug'].filter(Boolean).join('\n')
  selected.value = row
}
async function publish() {
  if (!selected.value || busy.value) {
    return
  }
  busy.value = true
  notice.value = ''
  let failed = ''
  try {
    await request('/desktop-releases/' + selected.value.build + '/publish', { method: 'POST', body: JSON.stringify({ expected: selected.value.base, notes: notes.value }), signal: AbortSignal.timeout(180000) })
    notice.value = '桌面版本已发布'
  } catch (e) {
    failed = errorMessage(e)
  } finally {
    selected.value = undefined
    await refresh()
    if (failed) {
      error.value = failed
    }
    busy.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <section class="desktop-releases" aria-label="桌面发布">
    <div class="desktop-summary">
      <div><small>当前桌面版本 · macOS Apple Silicon</small><strong>{{ data?.current ? '界面 ' + data.current.ui.version + ' · 核心 ' + data.current.core.version : loading ? '加载中…' : '暂无发布记录' }}</strong></div>
      <a
        v-if="data?.current"
        class="installer"
        :href="apiBase + '/system-updates/macos/aarch64/installer'"
      >下载安装包</a>
      <AdminButton :disabled="busy || loading" @click="refresh">刷新</AdminButton>
    </div>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <h3>构建记录</h3>
    <p v-if="data && !data.candidates.length">暂无桌面候选。首次发布时，请在 GitHub Actions 选择联合构建。</p>
    <article
      v-for="row in data?.candidates"
      :key="row.build"
      class="desktop-row"
    >
      <div><strong>{{ kinds[row.kind] }}</strong><small>界面 {{ row.ui.version }} · 核心 {{ row.core.version }}</small><small>{{ new Date(row.createdAt).toLocaleString() }}</small></div>
      <span>{{ row.state === 'pending' && row.base !== (data?.current?.build ?? null) ? '基线已变化' : states[row.state] }}</span>
      <AdminButton
        v-if="row.state === 'pending' && (row.kind !== 'ui' || row.base === data?.current?.build)"
        :disabled="!!downloading || busy"
        @click="downloadTrial(row)"
      >{{ downloading === row.build ? '准备下载…' : '下载体验版' }}</AdminButton>
      <AdminButton
        v-if="row.state === 'pending' && row.base === (data?.current?.build ?? null)"
        :disabled="busy || loading"
        @click="review(row)"
      >审核发布</AdminButton>
    </article>
    <AdminDialog
      :open="!!selected"
      title="确认发布桌面版本"
      :busy="busy"
      compact
      @close="selected = undefined"
    >
      <template v-if="selected">
        <p>{{ kinds[selected.kind] }} · macOS Apple Silicon</p>
        <dl>
          <dt>方舟界面</dt><dd>{{ data?.current?.ui.version ?? '首次发布' }} → {{ selected.ui.version }}</dd>
          <dt>桌面核心</dt><dd>{{ data?.current?.core.version ?? '首次发布' }} → {{ selected.core.version }}</dd>
          <dt>生效方式</dt><dd>{{ selected.kind === 'ui' ? '下载后刷新界面' : '安装核心后自动重启' }}</dd>

        </dl>
        <SystemReleaseNotes v-model="notes" />
      </template>
      <template #footer>
        <AdminButton :disabled="busy" @click="selected = undefined">取消</AdminButton>
        <AdminButton
          class="primary"
          :disabled="busy || !notes.trim()"
          @click="publish"
        >{{ busy ? '正在校验并发布…' : '确认发布' }}</AdminButton>
      </template>
    </AdminDialog>
  </section>
</template>

<style scoped>
.desktop-releases {
  max-width: 900px;
}
.desktop-summary,
.desktop-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: white;
  border: 1px solid #dce1e6;
}
.desktop-summary {
  flex-wrap: wrap;
  justify-content: flex-start;
  border-radius: 10px;
}
.desktop-summary > div {
  flex: 1;
}
.installer {
  font-size: 13px;
  color: #3152af;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .desktop-summary > div {
    flex: 0 0 100%;
  }
  .desktop-summary {
    row-gap: 10px;
  }
}
.desktop-summary strong {
  display: block;
  margin-top: 4px;
  font-size: 18px;
}
.desktop-releases small {
  display: block;
  color: #586674;
  font-size: 12px;
}
.desktop-releases h3 {
  font-size: 15px;
  margin: 22px 0 8px;
}
.desktop-row {
  flex-wrap: wrap;
  margin-top: -1px;
  font-size: 13px;
}
.desktop-row div {
  flex: 1;
  min-width: 150px;
}
.desktop-row small {
  margin-top: 4px;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px 16px;
  font-size: 14px;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
