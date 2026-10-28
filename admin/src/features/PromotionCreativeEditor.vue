<script setup lang="ts">
import type { PromotionCreativeDraft, PromotionCreativeSettings, PromotionImage } from '@t-box/shared'
import { defaultPromotionCreative } from '@t-box/shared'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import AdminButton from '../components/AdminButton.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminFileUpload from '../components/AdminFileUpload.vue'
import AdminInput from '../components/AdminInput.vue'
import AdminTextarea from '../components/AdminTextarea.vue'
import { apiBase, errorMessage, request, requestBlob, save } from '../core/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], saved: [] }>()
const draft = reactive<PromotionCreativeDraft>(defaultPromotionCreative())
const thumbnail = ref<PromotionImage | null>(null)
const poster = ref<PromotionImage | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const preview = ref('')
const width = computed(() => poster.value?.width ?? 1080)
const height = computed(() => poster.value?.height ?? 1920)
const asset = (path: string) => new URL(apiBase + path, location.href).href
const qrStyle = computed(() => ({ left: draft.qr.x + '%', top: draft.qr.y + '%', width: draft.qr.size + '%', aspectRatio: '1' }))
let generation = 0

function clearPreview() {
  if (preview.value) {
    URL.revokeObjectURL(preview.value)
    preview.value = ''
  }
}
function apply(settings: PromotionCreativeSettings) {
  const { thumbnail: thumb, poster: image, ...value } = settings
  Object.assign(draft, value)
  thumbnail.value = thumb
  poster.value = image
  clearPreview()
}
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  notice.value = ''
  clearPreview()
  try {
    const settings = await request<PromotionCreativeSettings>('/promotions/creatives')
    if (current === generation) {
      apply(settings)
    }
  } catch (cause) {
    if (current === generation) {
      error.value = errorMessage(cause)
    }
  } finally {
    if (current === generation) {
      loading.value = false
    }
  }
}
async function upload(event: Event, kind: PromotionImage['kind']) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const image = await request<PromotionImage>('/promotions/images/' + kind, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(60_000),
    })
    if (kind === 'thumbnail') {
      thumbnail.value = image
      draft.thumbnailId = image.id
    } else {
      poster.value = image
      draft.posterId = image.id
      // Start with a square in the lower-right corner; the administrator can move it.
      const size = Math.max(15, Math.min(24, 160 / image.width * 100))
      Object.assign(draft.qr, { x: Number((100 - size - 6).toFixed(2)), y: Number((100 - size * image.width / image.height - 6).toFixed(2)), size: Number(size.toFixed(2)) })
    }
    clearPreview()
    notice.value = '图片已上传。保存后将应用到所有渠道与个人分享。'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
async function generatePreview() {
  busy.value = true
  error.value = ''
  clearPreview()
  try {
    const blob = await requestBlob('/promotions/creatives/preview', { method: 'POST', body: JSON.stringify(draft) })
    preview.value = URL.createObjectURL(blob)
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
async function submit() {
  busy.value = true
  error.value = ''
  try {
    const settings = await save<PromotionCreativeSettings>('/promotions/creatives', draft, 'PUT')
    apply(settings)
    emit('saved')
    emit('close')
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
function resetImage(kind: PromotionImage['kind']) {
  if (kind === 'thumbnail') {
    draft.thumbnailId = null
    thumbnail.value = null
  } else {
    draft.posterId = null
    poster.value = null
    draft.qr = defaultPromotionCreative().qr
  }
  clearPreview()
}
watch(() => props.open, (open) => {
  if (open) {
    void load()
  } else {
    generation++
    clearPreview()
  }
})
watch(() => JSON.stringify(draft), clearPreview)
onBeforeUnmount(() => {
  generation++
  clearPreview()
})
</script>

<template>
  <AdminDialog
    :open="open"
    title="分享素材与文案"
    description="统一设置所有推广渠道和个人邀请使用的图片与文案。"
    :busy="busy"
    @close="emit('close')"
  >
    <p
      v-if="error"
      class="alert"
      role="alert"
    >{{ error }}<AdminButton v-if="!busy" @click="load">重新加载配置</AdminButton></p>
    <p
      v-if="notice"
      class="success"
      role="status"
    >{{ notice }}</p>
    <div v-if="loading" class="empty">正在读取分享配置…</div>
    <form
      v-else
      id="promotion-creative-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <label>分享标题<AdminInput
          v-model="draft.title"
          maxlength="80"
          required
        /></label>
        <label>分享描述<AdminTextarea
          v-model="draft.description"
          maxlength="300"
          :rows="3"
          required
        /></label>
        <section class="creative-section">
          <div><h3>微信分享图</h3><p>用于朋友和朋友圈分享，上传后自动裁剪为 300 × 300。</p></div>
          <img
            class="creative-thumbnail"
            :src="asset(thumbnail?.url ?? '/promotions/defaults/thumbnail.jpg')"
            alt="微信分享缩略图预览"
            width="300"
            height="300"
          >
          <div class="creative-actions"><AdminFileUpload
            label="上传分享图"
            accept=".jpg,.jpeg,.png,.webp"
            :disabled="busy"
            @change="upload($event, 'thumbnail')"
          /><AdminButton :disabled="busy" @click="resetImage('thumbnail')">恢复默认分享图</AdminButton></div>
        </section>
        <section class="creative-section">
          <div><h3>邀请海报</h3><p>上传不带二维码的底图，至少 600 × 600 像素。图片与分享图均支持 8 MB 内的 JPG、PNG、WebP。</p></div>
          <div class="creative-actions"><AdminFileUpload
            label="上传邀请海报"
            accept=".jpg,.jpeg,.png,.webp"
            :disabled="busy"
            @change="upload($event, 'poster')"
          /><AdminButton :disabled="busy" @click="resetImage('poster')">恢复默认邀请图</AdminButton></div>
          <div class="creative-poster" :style="{ aspectRatio: width + ' / ' + height }">
            <img
              :src="asset(poster?.url ?? '/promotions/defaults/poster.jpg')"
              alt="邀请海报底图与二维码位置"
              :width="width"
              :height="height"
            >
            <span class="creative-qr-area" :style="qrStyle">二维码</span>
          </div>
          <p class="creative-size">{{ width }} × {{ height }} 像素 · 二维码会按渠道或用户自动生成</p>
          <div class="creative-coordinates">
            <label>左侧位置（%）<AdminInput
              v-model.number="draft.qr.x"
              type="number"
              min="0"
              max="95"
              step="0.01"
              required
            /></label>
            <label>顶部位置（%）<AdminInput
              v-model.number="draft.qr.y"
              type="number"
              min="0"
              max="95"
              step="0.01"
              required
            /></label>
            <label>边长占图宽（%）<AdminInput
              v-model.number="draft.qr.size"
              type="number"
              min="5"
              max="80"
              step="0.01"
              required
            /></label>
          </div>
          <AdminButton :disabled="busy" @click="generatePreview">{{ busy ? '正在处理…' : '预览带码海报' }}</AdminButton>
          <template v-if="preview">
            <img
              class="creative-rendered"
              :src="preview"
              alt="实际二维码合成预览"
            >
            <p>预览图仅用于检查排版。正式推广请下载渠道或个人专属海报。</p>
          </template>
        </section>
      </fieldset>
    </form>
    <template #footer>
      <AdminButton :disabled="busy" @click="emit('close')">取消</AdminButton>
      <AdminButton
        class="primary"
        form="promotion-creative-form"
        type="submit"
        :disabled="busy || loading"
      >{{ busy ? '正在处理…' : '保存分享配置' }}</AdminButton>
    </template>
  </AdminDialog>
</template>

<style scoped>
fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.creative-section {
  border-top: 1px solid var(--line);
  margin-top: 24px;
  padding-top: 20px;
}
.creative-section h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.creative-section p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
.creative-thumbnail {
  width: 116px;
  height: 116px;
  object-fit: cover;
  border-radius: 10px;
  margin: 6px 0 14px;
}
.creative-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.creative-poster {
  position: relative;
  width: min(100%, 300px);
  margin: 16px auto;
  background: var(--line);
}
.creative-poster img {
  display: block;
  width: 100%;
  height: auto;
}
.creative-qr-area {
  position: absolute;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent);
  background: #fffffff0;
  color: var(--accent);
  font-size: 11px;
  overflow: hidden;
}
.creative-size {
  text-align: center;
}
.creative-coordinates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;
}
.creative-coordinates input {
  width: 100%;
}
.creative-coordinates label {
  font-size: 11px;
}
.creative-rendered {
  display: block;
  width: min(100%, 300px);
  height: auto;
  margin: 16px auto;
}
.alert .admin-button {
  margin-left: 10px;
}
@media (max-width: 420px) {
  .creative-coordinates {
    grid-template-columns: 1fr;
  }
}
</style>
