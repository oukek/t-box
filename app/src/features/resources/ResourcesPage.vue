<script setup lang="ts">
import type { Resource } from '@t-box/shared'
import { AppIcon, Modal } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onMounted, ref } from 'vue'
import ImageViewer from '../../components/ImageViewer.vue'
import ResourceImage from '../../components/ResourceImage.vue'
import { backFromApplication } from '../../core/navigation'
import { request } from '../../core/network'
import { downloadResource, fileSize, uploadResource } from './resourcesApi'

const filters = [
  { id: '', label: '全部' },
  { id: 'uploaded', label: '我上传的' },
  { id: 'generated', label: 'AI 生成' },
] as const
const items = ref<Resource[]>([])
const total = ref(0)
const quota = ref<{ bytes: number, maxBytes: number, files: number, maxFiles: number } | null>(null)
const page = ref(1)
const filter = ref('')
const loading = ref(false)
const error = ref('')
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()
const preview = ref<Resource | null>(null)
const previewImage = ref<Resource | null>(null)
let revision = 0
async function load(more = false) {
  const current = ++revision
  loading.value = true
  error.value = ''
  const next = more ? page.value + 1 : 1
  try {
    const [result, capacity] = await Promise.all([
      request<{ data: Resource[], meta: { total: number } }>(`/resources?page=${next}&source=${filter.value}`),
      request<{ data: NonNullable<typeof quota.value> }>('/resources/quota'),
    ])
    if (current !== revision) {
      return
    }
    items.value = more ? [...items.value, ...result.data] : result.data
    total.value = result.meta.total
    quota.value = capacity.data
    page.value = next
  } catch (cause) {
    if (current === revision) {
      error.value = cause instanceof Error ? cause.message : '读取资源失败'
    }
  } finally {
    if (current === revision) {
      loading.value = false
    }
  }
}
function choose(value: string) {
  filter.value = value
  void load()
}
async function upload(event: Event) {
  const files = [...((event.target as HTMLInputElement).files || [])]
  ;(event.target as HTMLInputElement).value = ''
  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      await uploadResource(file)
    }
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '上传失败'
  } finally {
    uploading.value = false
  }
}
async function download(resource: Resource) {
  try {
    await downloadResource(resource)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '下载失败'
  }
}
async function remove(resource: Resource) {
  // eslint-disable-next-line no-alert -- Preserve the existing confirmation before deleting a resource.
  if (!confirm(`删除「${resource.name}」？会话中的此附件也将无法访问。`)) {
    return
  }
  try {
    await request(`/resources/${resource.id}`, { method: 'DELETE' })
    preview.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除失败'
  }
}
onMounted(() => load())
</script>

<template>
  <section class="resources-page">
    <ApplicationHeader
      title="我的资源"
      back-label="AI"
      @back="backFromApplication"
    >
      <template #actions>
        <button
          class="button button-primary resource-upload"
          :disabled="uploading"
          @click="fileInput?.click()"
        >
          <AppIcon name="plus" :size="16" />{{ uploading ? "上传中…" : "上传" }}
        </button>
      </template>
    </ApplicationHeader>
    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept="image/png,image/jpeg,image/webp,.pdf,.txt,.md"
      multiple
      tabindex="-1"
      aria-label="上传资源文件"
      @change="upload"
    >
    <div class="resources-filter" aria-label="资源来源">
      <button
        v-for="item in filters"
        :key="item.id"
        :class="{ active: filter === item.id }"
        :aria-pressed="filter === item.id"
        @click="choose(item.id)"
      >
        {{ item.label }}
      </button><span>{{ total }} 个资源</span>
    </div>
    <p v-if="quota" class="resource-capacity">已用 {{ fileSize(quota.bytes) }} / {{ fileSize(quota.maxBytes) }} · {{ quota.files }} / {{ quota.maxFiles }} 个文件</p>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div v-if="!items.length" class="resource-empty">
      <AppIcon name="image" :size="38" />
      <h2>{{ loading ? "正在读取资源…" : "暂无资源" }}</h2>
      <p v-if="!loading">
        在会话中添加附件，或点击上传。<br>支持 PNG、JPEG、WebP、PDF
        和文本，每个文件最多 10 MB。
      </p>
    </div>
    <div v-else class="resource-grid">
      <article
        v-for="item in items"
        :key="item.id"
        class="resource-card"
      >
        <button
          class="resource-cover"
          :aria-label="`查看 ${item.name}`"
          @click="preview = item"
        >
          <ResourceImage
            v-if="item.mimeType.startsWith('image/')"
            :resource="item"
          /><span
            v-else
            class="resource-file-cover"
          ><AppIcon name="file" :size="32" /><small>{{
            item.mimeType === "application/pdf"
              ? "PDF"
              : item.mimeType === "text/plain"
                ? "文本文件"
                : "文件"
          }}</small></span><span v-if="item.source === 'generated'" class="resource-source">{{
            item.source === "generated" ? "AI 生成" : "已上传"
          }}</span>
        </button>
        <div class="resource-card-info">
          <h2 :title="item.name">
            {{ item.name }}
          </h2>
          <p>
            {{ fileSize(item.size) }} ·
            {{ new Date(item.createdAt).toLocaleDateString("zh-CN") }}
          </p>
          <button
            class="icon-button"
            :aria-label="`下载 ${item.name}`"
            @click="download(item)"
          >
            <AppIcon name="arrowDown" :size="18" />
          </button>
        </div>
      </article>
    </div>
    <button
      v-if="items.length < total"
      class="button button-secondary resource-load-more"
      :disabled="loading"
      @click="load(true)"
    >
      {{ loading ? "正在加载…" : "加载更多" }}
    </button><Modal
      :open="!!preview"
      :title="preview?.name || '资源详情'"
      @close="preview = null"
    >
      <template v-if="preview">
        <div class="resource-preview">
          <button
            v-if="preview.mimeType.startsWith('image/')"
            type="button"
            class="resource-detail-image"
            aria-label="查看图片大图"
            @click="previewImage = preview"
          >
            <ResourceImage :resource="preview" />
          </button>
          <AppIcon
            v-else
            name="file"
            :size="48"
          />
        </div>
        <p class="muted">
          {{ fileSize(preview.size) }} ·
          {{ preview.source === "generated" ? "AI 生成" : "我上传的" }}
        </p>
        <footer class="dialog-footer">
          <button class="button button-secondary" @click="remove(preview)"> 删除资源</button><button class="button button-primary" @click="download(preview)">
            下载文件
          </button>
        </footer>
      </template>
    </Modal>
    <ImageViewer :resource="previewImage" @close="previewImage = null" />
  </section>
</template>

<style scoped>
.resource-capacity {
  margin: 0 0 18px;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
