<script setup lang="ts">
import type { ApplicationFile } from '@t-box/app-contracts'
import type {
  BabyRecord,
  BabyRecordInput,
  BabyRecordKind,
} from '@t-box/baby-diary-contracts'
import {
  milestonePresets,
  parseRecord,
  scopeForRecord,
} from '@t-box/baby-diary-contracts'
import { BottomSheet, SheetSelect } from '@t-box/ui-kit'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import { reactive, ref } from 'vue'
import MediaThumb from './MediaThumb.vue'
import {
  base,
  errorText,
  host,
  invoke,
  manager,
  scope,
  today,
} from './runtime'

const props = defineProps<{ kind: BabyRecordKind, value?: BabyRecord }>()
const emit = defineEmits<{ close: [], saved: [] }>()
const draft = reactive<BabyRecordInput>(
  props.value
    ? {
        kind: props.value.kind,
        date: props.value.date,
        title: props.value.title,
        text: props.value.text,
        tags: [...props.value.tags],
        assetIds: [...props.value.assetIds],
        visibility: props.value.visibility,
        measurement: props.value.measurement
          ? { ...props.value.measurement }
          : null,
      }
    : {
        kind: props.kind,
        date: today(),
        title: '',
        text: '',
        tags: [],
        assetIds: [],
        visibility: 'members',
        measurement:
          props.kind === 'measurement' ? { method: 'unspecified' } : null,
      },
)
const height = ref(
  props.value?.measurement?.heightMm == null
    ? ''
    : String(props.value.measurement.heightMm / 10),
)
const weight = ref(
  props.value?.measurement?.weightGrams == null
    ? ''
    : String(props.value.measurement.weightGrams / 1000),
)
const head = ref(
  props.value?.measurement?.headMm == null
    ? ''
    : String(props.value.measurement.headMm / 10),
)
const tagText = ref(draft.tags.join('，'))
const busy = ref(false)
const error = ref('')
const assets = ref<ApplicationFile[]>([])
const titles = {
  diary: '写日记',
  measurement: '记测量',
  milestone: '记里程碑',
}
if (draft.assetIds.length) {
  void invoke<ApplicationFile[]>('assets_list', {
    ...base(),
    scope: scope(scopeForRecord(draft.kind), draft.visibility).type,
    ids: draft.assetIds,
  })
    .then((value) => {
      assets.value = value
    })
    .catch((e) => {
      error.value = errorText(e)
    })
}
async function pick(images: boolean) {
  busy.value = true
  error.value = ''
  try {
    const files = await host().files.private.pick(
      scope(scopeForRecord(draft.kind), draft.visibility),
      { multiple: true, ...(images ? { accept: 'image/*' } : {}) },
    )
    if (draft.assetIds.length + files.length > 20) {
      error.value = '每条记录最多添加 20 个附件'
      return
    }
    draft.assetIds.push(...files.map((f) => f.id))
    assets.value.push(...files)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
function remove(id: string) {
  draft.assetIds = draft.assetIds.filter((value) => value !== id)
  assets.value = assets.value.filter((value) => value.id !== id)
}
async function save() {
  busy.value = true
  error.value = ''
  try {
    const input: BabyRecordInput = {
      kind: draft.kind,
      date: draft.date,
      title: draft.title,
      text: draft.text,
      tags: tagText.value
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter(Boolean),
      assetIds: [...draft.assetIds],
      visibility: draft.visibility,
      measurement: draft.measurement
        ? {
            method: draft.measurement.method,
            ...(height.value
              ? { heightMm: Math.round(Number(height.value) * 10) }
              : {}),
            ...(weight.value
              ? { weightGrams: Math.round(Number(weight.value) * 1000) }
              : {}),
            ...(head.value
              ? { headMm: Math.round(Number(head.value) * 10) }
              : {}),
          }
        : null,
    }
    parseRecord(input)
    await invoke(
      props.value ? 'records_update' : 'records_add',
      props.value
        ? {
            ...base(),
            recordId: props.value.id,
            revision: props.value.revision,
            record: input,
          }
        : { ...base(), records: [input] },
    )
    emit('saved')
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BottomSheet
    open
    full-height
    :title="value ? '编辑记录' : titles[kind]"
    :busy="busy"
    @close="emit('close')"
  >
    <form
      id="baby-record-form"
      class="form-stack"
      @submit.prevent="save"
    >
      <div class="two-columns">
        <label>发生日期<DateField
          v-model="draft.date"
          label="记录日期"
          :max="today()"
        /></label><label>可见范围<SheetSelect
          v-model="draft.visibility"
          :disabled="!!value || !!draft.assetIds.length || !manager"
          label="可见范围"
          :options="[
            { value: 'members', label: '授权成员' },
            { value: 'managers', label: '仅管理者' },
          ]"
        /></label>
      </div>
      <template v-if="draft.measurement">
        <div class="measurement-inputs">
          <label>身长 / 身高 · cm<input
            v-model="height"
            type="number"
            min="10"
            max="250"
            step="0.1"
            inputmode="decimal"
            placeholder="例如 65.5"
          ></label><label>体重 · kg<input
            v-model="weight"
            type="number"
            min="0.1"
            max="200"
            step="0.001"
            inputmode="decimal"
            placeholder="例如 7.25"
          ></label><label>头围 · cm<input
            v-model="head"
            type="number"
            min="10"
            max="100"
            step="0.1"
            inputmode="decimal"
            placeholder="例如 42.0"
          ></label>
        </div>
        <label>测量方式<SheetSelect
          v-model="draft.measurement.method"
          label="测量方式"
          :options="[
            { value: 'unspecified', label: '未注明' },
            { value: 'lying', label: '躺着量身长' },
            { value: 'standing', label: '站着量身高' },
          ]"
        /></label>
      </template>
      <label>{{ kind === "measurement" ? "标题（可选）" : "标题"
      }}<input
        v-model="draft.title"
        maxlength="100"
        :required="kind !== 'measurement'"
        :placeholder="
          kind === 'milestone' ? '今天有了哪个第一次？' : '给今天起个小标题'
        "
      ></label>
      <div v-if="kind === 'milestone'" class="chips">
        <button
          v-for="title in milestonePresets"
          :key="title"
          type="button"
          class="chip"
          @click="draft.title = title"
        >
          {{ title }}
        </button>
      </div>
      <label>{{ kind === "measurement" ? "测量备注" : "这一刻，想记住…"
      }}<textarea
        v-model="draft.text"
        rows="5"
        maxlength="10000"
        placeholder="一些小细节，以后回看也会很珍贵。"
      />
      </label>
      <label>标签（用逗号分隔）<input
        v-model="tagText"
        maxlength="210"
        placeholder="日常，开心的一天"
      ></label>
      <div class="section-heading">
        <h3>
          照片与附件 <small>{{ draft.assetIds.length }}/20</small>
        </h3>
        <div class="inline-actions">
          <button
            type="button"
            class="text-button"
            :disabled="busy"
            @click="pick(true)"
          >
            加照片</button><button
            type="button"
            class="text-button"
            :disabled="busy"
            @click="pick(false)"
          >
            加文件
          </button>
        </div>
      </div>
      <div v-if="assets.length" class="attachment-grid">
        <div
          v-for="file in assets"
          :key="file.id"
          class="attachment"
        >
          <MediaThumb
            v-if="file.mimeType.startsWith('image/')"
            :id="file.id"
            :alt="file.name"
          /><span v-else class="file-tile">{{ file.name }}</span><button
            type="button"
            class="remove-attachment"
            :aria-label="`移除${file.name}`"
            @click="remove(file.id)"
          >
            ×
          </button>
        </div>
      </div>
      <p class="subtle">
        每个文件最大 10 MB，私有保存。取消编辑后未使用的上传会自动清理。
      </p>
      <p
        v-if="error"
        class="error"
        role="alert"
      >{{ error }}</p>
    </form>
    <template #footer><button
      class="primary full"
      form="baby-record-form"
      :disabled="busy"
    >
      {{ busy ? "处理中…" : "保存这条记录" }}
    </button></template>
  </BottomSheet>
</template>
