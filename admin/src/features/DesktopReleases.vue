<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import { apiBase, errorMessage, request } from '../core/api'

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
async function publish() {
  if (!selected.value || busy.value) {
    return
  }
  busy.value = true
  notice.value = ''
  let failed = ''
  try {
    await request('/desktop-releases/' + selected.value.build + '/publish', { method: 'POST', body: JSON.stringify({ expected: selected.value.base }), signal: AbortSignal.timeout(180000) })
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
        v-if="row.state === 'pending' && row.base === (data?.current?.build ?? null)"
        :disabled="busy || loading"
        @click="selected = row"
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
          <dt>更新说明</dt><dd>{{ selected.notes || '无' }}</dd>
        </dl>
      </template>
      <template #footer>
        <AdminButton :disabled="busy" @click="selected = undefined">取消</AdminButton>
        <AdminButton
          class="primary"
          :disabled="busy"
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
