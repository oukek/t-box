<script setup lang="ts">
import type { BabyInput, BabyProfile, BabyTheme } from '@t-box/baby-diary-contracts'
import { parseBaby } from '@t-box/baby-diary-contracts'
import { BottomSheet, SheetSelect } from '@t-box/ui-kit'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import { reactive, ref } from 'vue'
import BabyThemePicker from './BabyThemePicker.vue'
import { errorText, invoke, runtime, today } from './runtime'
import { useBabyThemePreview } from './useBabyTheme'

const props = defineProps<{ value?: BabyProfile }>()
const emit = defineEmits<{ close: [], saved: [baby: BabyProfile] }>()
const draft = reactive<BabyInput & { theme: BabyTheme | null }>({
  name: props.value?.name || '',
  birthDate: props.value?.birthDate || null,
  sex: props.value?.sex || 'unknown',
  theme: props.value?.theme ?? null,
  timezone:
    props.value?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
})
useBabyThemePreview(draft)
const displayName = ref(runtime.nickname)
const busy = ref(false)
const error = ref('')
async function save() {
  busy.value = true
  error.value = ''
  try {
    const input = parseBaby(draft)
    const baby = await invoke<BabyProfile>(
      props.value ? 'babies_update' : 'babies_create',
      props.value
        ? {
            babyId: props.value.id,
            revision: props.value.revision,
            baby: input,
          }
        : { baby: input, displayName: displayName.value },
    )
    emit('saved', baby)
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
    :title="value ? '编辑宝宝档案' : '创建宝宝档案'"
    :busy="busy"
    @close="emit('close')"
  >
    <form
      id="baby-profile-form"
      class="form-stack"
      @submit.prevent="save"
    >
      <label>宝宝昵称<input
        v-model="draft.name"
        maxlength="40"
        placeholder="想怎么称呼宝宝？"
        required
      ></label>
      <label>出生日期<DateField
        :model-value="draft.birthDate || ''"
        label="出生日期"
        :max="today()"
        clearable
        @update:model-value="draft.birthDate = $event || null"
      /></label>
      <label>性别<SheetSelect
        v-model="draft.sex"
        label="性别"
        :options="[
          { value: 'unknown', label: '暂不填写' },
          { value: 'female', label: '女孩' },
          { value: 'male', label: '男孩' },
        ]"
      /></label>
      <BabyThemePicker v-model="draft.theme" :sex="draft.sex" />
      <label>记录时区<input
        v-model="draft.timezone"
        maxlength="80"
        placeholder="Asia/Shanghai"
        required
      ></label>
      <label v-if="!value">你在档案中的称呼<input
        v-model="displayName"
        maxlength="40"
        placeholder="例如：妈妈、爸爸"
        required
      ></label>
      <p class="subtle">每个宝宝有独立的记录和成员。出生日期可稍后补充。</p>
      <p
        v-if="error"
        class="error"
        role="alert"
      >{{ error }}</p>
    </form>
    <template #footer><button
      class="primary full"
      form="baby-profile-form"
      :disabled="busy"
    >
      {{ busy ? "保存中…" : "保存档案" }}
    </button></template>
  </BottomSheet>
</template>
