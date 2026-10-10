<script setup lang="ts">
import { ref, watch } from "vue";
import { AppIcon } from "@t-box/ui-kit";
import {
  LEDGER_ATTACHMENT_LIMIT,
  LEDGER_ATTACHMENT_MAX_BYTES,
} from "@t-box/ledger-contracts";
import { featureApi } from "./api";
const ids = defineModel<string[]>({ default: () => [] });
const props = defineProps<{
  ledgerId: string;
  disabled?: boolean;
  limit?: number;
}>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const uploading = ref(false),
  error = ref(""),
  names = ref<Record<string, string>>({}),
  progress = ref("");
watch(
  ids,
  async (value) => {
    for (const id of value)
      if (!names.value[id]) {
        try {
          names.value[id] = (
            await featureApi(props.ledgerId).get(`/attachment-resources/${id}`)
          ).name;
        } catch {
          names.value[id] = "已选择附件";
        }
      }
  },
  { immediate: true },
);
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    files = Array.from(input.files ?? []);
  input.value = "";
  if (uploading.value || props.disabled || !files.length) return;
  error.value = "";
  if (
    ids.value.length + files.length >
    (props.limit ?? LEDGER_ATTACHMENT_LIMIT)
  ) {
    error.value = "每笔最多 20 个附件，请减少选择数量";
    return;
  }
  if (files.some((f) => !f.size || f.size > LEDGER_ATTACHMENT_MAX_BYTES)) {
    error.value = "每个附件需为 1 字节至 10 MB";
    return;
  }
  uploading.value = true;
  emit("busy", true);
  try {
    for (const [index, file] of files.entries()) {
      progress.value = `正在上传 ${index + 1}/${files.length} · ${file.name}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const resource = await featureApi(props.ledgerId).write(
        "/attachment-resources",
        { name: file.name, base64: btoa(raw) },
      );
      names.value[resource.id] = resource.name;
      ids.value = [...ids.value, resource.id];
    }
  } catch (e) {
    error.value = `${(e as Error).message}；已上传的附件保留，可继续添加。`;
  } finally {
    uploading.value = false;
    progress.value = "";
    emit("busy", false);
  }
}
</script>
<template>
  <section class="record-attachments">
    <div class="attachment-heading">
      <strong
        >图片与文件 <small>{{ ids.length }}/{{ limit ?? 20 }}</small></strong
      ><label
        class="attachment-upload"
        :class="{ disabled: disabled || uploading }"
        ><AppIcon name="attach" :size="16" />添加<input
          type="file"
          multiple
          :disabled="disabled || uploading"
          @change="upload"
          class="sr-only"
      /></label>
    </div>
    <p class="feature-hint">
      支持多选图片、任意类型文件，每个最大 10 MB。原文件保存在我的资源。
    </p>
    <div v-for="id in ids" :key="id" class="attachment-file">
      <AppIcon name="file" :size="18" /><span>{{
        names[id] ?? "已选择附件"
      }}</span
      ><button
        type="button"
        aria-label="移除所选附件"
        :disabled="disabled || uploading"
        @click="ids = ids.filter((value) => value !== id)"
      >
        <AppIcon name="close" :size="16" />
      </button>
    </div>
    <p v-if="progress" class="feature-hint" role="status">{{ progress }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
<style>
.record-attachments {
  margin-top: 16px;
  min-width: 0;
}
.attachment-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.attachment-heading small {
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 5px;
}
.attachment-upload {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  position: relative;
  cursor: pointer;
  color: var(--accent, #397c70);
  padding: 5px 0;
  font-size: 12px;
}
.attachment-upload.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.attachment-file {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 0;
  border-bottom: 1px solid var(--border, #e6eceb);
  font-size: 12px;
}
.attachment-file > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-file > button {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.attachment-gallery {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 10px 0;
}
.attachment-gallery > button {
  padding: 0;
  position: relative;
  border: 1px solid var(--border, #e6eceb);
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1;
  background: #f2f6f5;
  cursor: pointer;
}
.attachment-gallery img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.attachment-gallery span {
  font-size: 11px;
}
.attachment-file small {
  color: var(--text-muted);
}
</style>
