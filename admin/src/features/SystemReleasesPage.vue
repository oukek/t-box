<script setup lang="ts">
import { compareSystemVersions } from '@t-box/app-contracts'
import { onMounted, ref } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import { errorMessage, request } from '../core/api'

import DesktopReleases from './DesktopReleases.vue'
import SystemReleaseNotes from './SystemReleaseNotes.vue'

const channel = ref<'web' | 'desktop'>('web')
const labels = { pending: '待确认', publishing: '发布中', failed: '发布中断', live: '当前生效', archived: '历史版本' }
interface Candidate {
  coreVersion?: string | null
  shared?: boolean
  build: string
  version: string
  notes?: string
  digest: string
  state: keyof typeof labels
  files: number
  bytes: number
  createdAt: string
}
interface Listing { current: Candidate | null, interrupted: Candidate | null, candidates: Candidate[] }
const listing = ref<Listing>()
const selected = ref<Candidate>()
const expected = ref<string | null>(null)
const notes = ref('')
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
async function refresh() {
  loading.value = true
  try {
    listing.value = await request<Listing>('/system-releases')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
function review(row: Candidate) {
  notes.value = row.notes || '优化修复 bug'
  selected.value = row
  expected.value = listing.value?.current?.build ?? null
  error.value = ''
  notice.value = ''
}
function canPublish(row: Candidate) {
  const { current, interrupted } = listing.value!
  return row.state !== 'archived' && (!current || compareSystemVersions(row.version, current.version) > 0) && (!interrupted || interrupted.build === row.build)
}
async function publish() {
  if (!selected.value || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await request('/system-releases/' + selected.value.build + '/publish', {
      method: 'POST',
      body: JSON.stringify({ expected: expected.value, notes: notes.value }),
      signal: AbortSignal.timeout(180000),
    })
    notice.value = '主界面 ' + selected.value.version + ' 已发布'
    selected.value = undefined
  } catch (e) {
    error.value = errorMessage(e)
    selected.value = undefined
  } finally {
    await refresh()
    busy.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <nav class="channels" aria-label="发布渠道">
    <AdminButton
      :aria-pressed="channel === 'web'"
      :disabled="busy"
      @click="channel = 'web'"
    >主界面</AdminButton>
    <AdminButton
      :aria-pressed="channel === 'desktop'"
      :disabled="busy"
      @click="channel = 'desktop'"
    >桌面端</AdminButton>
  </nav>
  <DesktopReleases v-if="channel === 'desktop'" />
  <section
    v-else
    class="system-releases"
    aria-label="主界面发布"
  >
    <div class="release-summary">
      <div><small>当前主界面</small><strong>{{ listing?.current?.version ?? (loading ? '加载中…' : '暂无发布记录') }}</strong></div>
      <AdminButton :disabled="busy || loading" @click="refresh">刷新</AdminButton>
    </div>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <h3>构建记录</h3>
    <p v-if="listing && !listing.candidates.length" class="empty">暂无候选版本。通过 GitHub Actions 提交主界面构建后，在这里确认发布。</p>
    <article
      v-for="row in listing?.candidates"
      :key="row.build"
      class="release-row"
    >
      <div><strong>v{{ row.version }}</strong><small>{{ new Date(row.createdAt).toLocaleString() }}</small></div>
      <span :class="{ live: row.state === 'live' }">{{ labels[row.state] }}</span>
      <AdminButton
        v-if="canPublish(row)"
        :disabled="busy || loading"
        @click="review(row)"
      >{{ ['publishing', 'failed'].includes(row.state) ? '恢复发布' : '审核发布' }}</AdminButton>
    </article>
    <AdminDialog
      :open="!!selected"
      title="确认发布主界面"
      :busy="busy"
      compact
      @close="selected = undefined"
    >
      <template v-if="selected">
        <p>发布后，{{ selected.shared ? '网页、PWA 和 Mac' : '网页和 PWA' }} 将提示更新到 <strong>v{{ selected.version }}</strong>。</p>
        <p v-if="selected.coreVersion">本次同时发布 Mac 核心 <strong>v{{ selected.coreVersion }}</strong>，桌面更新完成后会重启。</p>
        <dl><dt>当前发布记录</dt><dd>{{ listing?.current?.version ?? '首次发布' }}</dd><dt>候选资源</dt><dd>{{ selected.files }} 个文件 · {{ (selected.bytes / 1048576).toFixed(1) }} MB</dd><dt>SHA-256</dt><dd class="digest">{{ selected.digest }}</dd></dl>
        <SystemReleaseNotes v-model="notes" :readonly="!!selected.notes" />
      </template>
      <template #footer>
        <AdminButton :disabled="busy" @click="selected = undefined">取消</AdminButton>
        <AdminButton
          class="primary"
          :disabled="busy || !notes.trim()"
          @click="publish"
        >{{ busy ? '正在发布…' : '确认发布' }}</AdminButton>
      </template>
    </AdminDialog>
  </section>
</template>

<style scoped>
.channels {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.channels [aria-pressed='true'] {
  background: #e8efed;
  border-color: #8ca59d;
}

.system-releases {
  max-width: 900px;
}
.release-summary,
.release-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: white;
  border: 1px solid #dce1e6;
}
.release-summary {
  justify-content: space-between;
  border-radius: 10px;
}
.release-summary strong {
  display: block;
  font-size: 22px;
}
.system-releases small {
  display: block;
  color: #586674;
  font-size: 12px;
}
.system-releases h3 {
  font-size: 15px;
  margin: 22px 0 8px;
}
.release-row {
  flex-wrap: wrap;
  border-bottom: 0;
  font-size: 13px;
}
.release-row:last-of-type {
  border-bottom: 1px solid #dce1e6;
}
.release-row div {
  flex: 1;
  min-width: 128px;
}
.release-row small {
  margin-top: 3px;
}
.live {
  color: #18644b;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 18px;
  font-size: 13px;
}
dt {
  color: #586674;
}
dd {
  margin: 0;
}
.digest {
  overflow-wrap: anywhere;
  font-family: monospace;
}
</style>
