<script setup lang="ts">
import type { ApplicationFile } from '@t-box/app-contracts'
import type { BabyRecord } from '@t-box/baby-diary-contracts'
import { scopeForRecord } from '@t-box/baby-diary-contracts'
import { Modal } from '@t-box/ui-kit'
import { onBeforeUnmount, ref, watch } from 'vue'
import MediaThumb from './MediaThumb.vue'
import {
  baby,
  canEdit,
  downloadFile,
  errorText,
  invoke,
  onPrivateClear,
  scope,
} from './runtime'

const props = defineProps<{ record: BabyRecord }>()
defineEmits<{ edit: [], remove: [] }>()
const assets = ref<ApplicationFile[]>([])
const viewing = ref<ApplicationFile>()
const error = ref('')
let version = 0
watch(
  () => props.record,
  async (record) => {
    const current = ++version
    assets.value = []
    error.value = ''
    if (!record.assetIds.length) {
      return
    }
    try {
      const result = await invoke<ApplicationFile[]>('assets_list', {
        babyId: record.babyId,
        scope: scope(scopeForRecord(record.kind), record.visibility).type,
        ids: record.assetIds,
      })
      if (version === current) {
        assets.value = result
      }
    } catch (e) {
      if (version === current) {
        error.value = errorText(e)
      }
    }
  },
  { immediate: true },
)
const stop = onPrivateClear(() => {
  version++
  assets.value = []
  viewing.value = undefined
})
onBeforeUnmount(() => {
  version++
  stop()
})
async function download(file: ApplicationFile) {
  try {
    await downloadFile(file.id)
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <article class="record-card">
    <div class="record-top">
      <span class="record-kind" :class="record.kind">{{
        { diary: "日记", measurement: "测量", milestone: "第一次" }[record.kind]
      }}</span><span
        v-if="record.visibility === 'managers'"
        class="subtle"
      >仅管理者</span><span class="record-author">{{ record.authorName }}</span>
    </div>
    <h3 v-if="record.title">{{ record.title }}</h3>
    <div v-if="record.measurement" class="measurement-values">
      <span v-if="record.measurement.heightMm != null"><b>{{ record.measurement.heightMm / 10 }}</b> cm
        <small>身长/身高</small></span><span v-if="record.measurement.weightGrams != null"><b>{{ record.measurement.weightGrams / 1000 }}</b> kg
        <small>体重</small></span><span v-if="record.measurement.headMm != null"><b>{{ record.measurement.headMm / 10 }}</b> cm
        <small>头围</small></span>
    </div>
    <p v-if="record.text" class="journal-text">{{ record.text }}</p>
    <div v-if="assets.length" class="record-attachments">
      <template
        v-for="file in assets"
        :key="file.id"
      ><button
        v-if="file.mimeType.startsWith('image/')"
        class="photo-button"
        :aria-label="`查看照片：${file.name}`"
        @click="viewing = file"
      >
        <MediaThumb :id="file.id" :alt="file.name" /></button><button
        v-else
        class="file-button"
        :disabled="!baby?.allowExport"
        @click="download(file)"
      >
        <span>↧</span>{{ file.name }}
      </button></template>
    </div>
    <div class="record-bottom">
      <div class="tags">
        <span v-for="tag in record.tags" :key="tag">#{{ tag }}</span>
      </div>
      <div v-if="canEdit(record.author)" class="inline-actions">
        <button class="text-button" @click="$emit('edit')">编辑</button><button class="text-button muted" @click="$emit('remove')">
          删除
        </button>
      </div>
    </div>
    <p
      v-if="error"
      class="error"
      role="alert"
    >{{ error }}</p>
  </article>
  <Modal
    :open="!!viewing"
    title="照片"
    @close="viewing = undefined"
  ><div v-if="viewing" class="large-photo">
     <MediaThumb :id="viewing.id" :alt="viewing.name" />
   </div>
    <template
      v-if="baby?.allowExport && viewing"
      #footer
    ><button class="text-button" @click="download(viewing)">
      下载原图
    </button></template></Modal>
</template>
