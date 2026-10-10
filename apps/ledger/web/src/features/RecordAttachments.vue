<script setup lang="ts">
import type {
  LedgerAttachment,
  LedgerRecordKind,
} from '@t-box/ledger-contracts'
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { onBeforeUnmount, ref, watch } from 'vue'
import { featureApi, useFeatureAction } from './api'
import AttachmentPicker from './AttachmentPicker.vue'

const props = defineProps<{
  ledgerId: string
  kind: LedgerRecordKind
  recordId: string
  canWrite: boolean
}>()
const action = useFeatureAction()
const files = ref<LedgerAttachment[]>([])
const pending = ref<string[]>([])
const uploading = ref(false)
const urls = ref<Record<string, string>>({})
const selected = ref<LedgerAttachment | null>(null)
const removing = ref<LedgerAttachment | null>(null)
let generation = 0
const image = (f: LedgerAttachment) =>
  ['image/png', 'image/jpeg', 'image/webp'].includes(f.mimeType)
const path = () => `/records/${props.kind}/${props.recordId}/attachments`
function cleanup() {
  Object.values(urls.value).forEach(URL.revokeObjectURL)
  urls.value = {}
  selected.value = null
}
async function content(file: LedgerAttachment) {
  if (urls.value[file.id]) {
    return urls.value[file.id]!
  }
  const version = generation
  const data = await featureApi(props.ledgerId).get(
    `/attachments/${file.id}/content`,
  )
  if (version !== generation) {
    return
  }
  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))
  return (urls.value[file.id] = URL.createObjectURL(
    new Blob([bytes], {
      type: image(file) ? file.mimeType : 'application/octet-stream',
    }),
  ))
}
async function load() {
  const version = ++generation
  cleanup()
  try {
    const rows = await featureApi(props.ledgerId).get<LedgerAttachment[]>(
      path(),
    )
    if (version !== generation) {
      return
    }
    files.value = rows
    await Promise.all(
      rows.filter(image).map(async (f) => {
        try {
          await content(f)
        } catch {
          /* Individual images remain available to retry. */
        }
      }),
    )
  } catch (e) {
    if (version === generation) {
      action.error.value = (e as Error).message
    }
  }
}
async function attach() {
  if (!pending.value.length || uploading.value) {
    return
  }
  const body = { resourceIds: pending.value }
  const result = await action.run(path(), body, (k) =>
    featureApi(props.ledgerId).write(path(), body, 'POST', k))
  if (result) {
    pending.value = []
    await load()
  }
}
async function view(file: LedgerAttachment) {
  try {
    await content(file)
    selected.value = file
  } catch (e) {
    action.error.value = (e as Error).message
  }
}
async function remove() {
  if (!removing.value) {
    return
  }
  const endpoint = `${path()}/${removing.value.id}`
  if (
    await action.run(endpoint, {}, (k) =>
      featureApi(props.ledgerId).write(endpoint, {}, 'DELETE', k))
  ) {
    removing.value = null
    await load()
  }
}
watch(
  () => [props.ledgerId, props.kind, props.recordId],
  () => {
    pending.value = []
    files.value = []
    action.error.value = ''
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
  cleanup()
})
</script>

<template>
  <section class="record-attachments">
    <h3 class="feature-section-title">
      图片与文件 <small>{{ files.length }}/20</small>
    </h3>
    <div v-if="files.some(image)" class="attachment-gallery">
      <button
        v-for="file in files.filter(image)"
        :key="file.id"
        type="button"
        :aria-label="`查看大图：${file.name}`"
        @click="view(file)"
      >
        <img
          v-if="urls[file.id]"
          :src="urls[file.id]"
          :alt="file.name"
        ><span
          v-else
        >查看图片</span>
      </button>
    </div>
    <div
      v-for="file in files"
      :key="file.id"
      class="attachment-file"
    >
      <AppIcon name="file" :size="17" /><span>{{ file.name }}
        <small>{{ (Number(file.size) / 1024).toFixed(1) }} KB</small></span><button
        type="button"
        :aria-label="`查看或下载：${file.name}`"
        @click="view(file)"
      >
        <AppIcon name="arrowDown" :size="17" />
      </button><button
        v-if="canWrite"
        type="button"
        :aria-label="`移除附件：${file.name}`"
        @click="removing = file"
      >
        <AppIcon name="trash" :size="17" />
      </button>
    </div>
    <p v-if="!files.length" class="feature-hint">暂无附件</p>
    <AttachmentPicker
      v-if="canWrite && files.length < 20"
      v-model="pending"
      :ledger-id="ledgerId"
      :limit="20 - files.length"
      :disabled="action.busy.value"
      @busy="uploading = $event"
    />
    <button
      v-if="pending.length"
      type="button"
      class="button button-primary"
      :disabled="uploading || action.busy.value"
      @click="attach"
    >
      关联 {{ pending.length }} 个附件
    </button>
    <p
      v-if="action.error.value"
      class="form-error"
      role="alert"
    >
      {{ action.error.value }}
    </p>
  </section>
  <BottomSheet
    :open="!!selected"
    :title="selected?.name ?? '查看附件'"
    full-height
    compact
    @close="selected = null"
  >
    <img
      v-if="selected && image(selected)"
      :src="urls[selected.id]"
      :alt="selected.name"
      style="display: block; width: 100%; height: auto; border-radius: 8px"
    >
    <p v-else class="feature-hint">此类型文件请下载后查看。</p>
    <template #footer>
      <a
        v-if="selected"
        class="button button-primary"
        :href="urls[selected.id]"
        :download="selected.name"
      >下载文件</a>
    </template>
  </BottomSheet>
  <BottomSheet
    :open="!!removing"
    title="移除附件？"
    :busy="action.busy.value"
    compact
    @close="removing = null"
  >
    <p>只移除此记录的关联，上传者的原文件仍保留在资源中。</p>
    <template #footer>
      <button
        class="button button-secondary"
        :disabled="action.busy.value"
        @click="removing = null"
      > 取消</button><button
        class="button button-primary"
        :disabled="action.busy.value"
        @click="remove"
      >
        确认移除
      </button>
    </template>
  </BottomSheet>
</template>
