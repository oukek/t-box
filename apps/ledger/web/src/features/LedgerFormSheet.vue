<script setup lang="ts">
import type { FormValues, LedgerFormField } from './form'
import { BottomSheet, SheetSelect } from '@t-box/ui-kit'
import DateSheetField from '@t-box/ui-kit/DateSheetField.vue'
import { ref } from 'vue'
import AttachmentPicker from './AttachmentPicker.vue'

defineProps<{
  open: boolean
  title: string
  fields: LedgerFormField[]
  busy?: boolean
  error?: string
  submitLabel?: string
  description?: string
  ledgerId?: string
  attachments?: boolean
}>()
const emit = defineEmits<{ close: [], submit: [] }>()
const values = defineModel<FormValues>({ required: true })
const attachmentResourceIds = defineModel<string[]>('attachmentResourceIds', {
  default: () => [],
})
const uploading = ref(false)
const formId = `ledger-feature-form-${Math.random().toString(36).slice(2)}`
</script>

<template>
  <BottomSheet
    :open="open"
    :title="title"
    :busy="busy || uploading"
    full-height
    compact
    @close="!uploading && emit('close')"
  >
    <p v-if="description" class="feature-hint">
      {{ description }}
    </p>
    <form :id="formId" @submit.prevent="!uploading && emit('submit')">
      <fieldset class="form-fields" :disabled="busy">
        <legend class="sr-only">
          {{ title }}
        </legend>
        <template
          v-for="field in fields"
          :key="field.key"
        >
          <label
            v-if="field.kind === 'checkbox'"
            class="feature-check"
          ><input v-model="values[field.key]" type="checkbox">{{
            field.label
          }}</label>
          <div v-else class="form-field">
            <label
              :for="`${formId}-${field.key}`"
              class="field-label"
            >{{ field.label }}{{ field.required ? " *" : "" }}</label><SheetSelect
              v-if="field.kind === 'select'"
              :model-value="values[field.key] ?? ''"
              :options="field.options ?? []"
              :label="`选择${field.label}`"
              :disabled="busy"
              @update:model-value="values[field.key] = $event"
            /><DateSheetField
              v-else-if="field.kind === 'date' || field.kind === 'month'"
              :model-value="String(values[field.key] ?? '')"
              :mode="field.kind === 'month' ? 'month' : 'date'"
              :clearable="field.clearable"
              :label="`选择${field.label}`"
              :disabled="busy"
              @update:model-value="values[field.key] = $event"
            /><textarea
              v-else-if="field.kind === 'textarea'"
              :id="`${formId}-${field.key}`"
              :value="String(values[field.key] ?? '')"
              :maxlength="field.max ?? 200"
              :required="field.required"
              rows="3"
              @input="
                values[field.key] = ($event.target as HTMLTextAreaElement).value
              "
            /><input
              v-else
              :id="`${formId}-${field.key}`"
              v-model="values[field.key]"
              :type="field.kind === 'number' ? 'number' : 'text'"
              :inputmode="field.kind === 'money' ? 'decimal' : undefined"
              :maxlength="field.max ?? 200"
              :required="field.required"
            ><small v-if="field.hint" class="feature-hint">{{
              field.hint
            }}</small>
          </div>
        </template>
      </fieldset>
      <AttachmentPicker
        v-if="attachments && ledgerId && open"
        v-model="attachmentResourceIds"
        :ledger-id="ledgerId"
        :disabled="busy"
        @busy="uploading = $event"
      />
      <p
        v-if="error"
        class="form-error"
        role="alert"
      >
        {{ error }}
      </p>
    </form>
    <template #footer>
      <button
        type="button"
        class="button button-secondary"
        :disabled="busy || uploading"
        @click="emit('close')"
      > 取消</button><button
        class="button button-primary"
        :form="formId"
        type="submit"
        :disabled="busy || uploading"
      >
        {{
          uploading
            ? "附件上传中…"
            : busy
              ? "正在处理…"
              : (submitLabel ?? "保存")
        }}
      </button>
    </template>
  </BottomSheet>
</template>
