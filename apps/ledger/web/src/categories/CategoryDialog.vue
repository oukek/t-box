<script setup lang="ts">
import type { BillCategory } from '@t-box/ledger-contracts'
import { AppIcon, Modal } from '@t-box/ui-kit'
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { featureApi, useFeatureAction } from '../features/api'
import { createRequestId } from '../runtime'
import CategoryIcon from './CategoryIcon.vue'
import { defaultCategoryIcons } from './defaultIcons'
import { categoryThumbnail } from './image'

const props = defineProps<{
  open: boolean
  ledgerId: string
  type: 'income' | 'expense'
  category?: BillCategory
}>()
const emit = defineEmits<{
  close: []
  saved: [category: BillCategory]
  busy: [value: boolean]
}>()
const action = useFeatureAction()
const uploading = ref(false)
const saving = ref(false)
const preview = ref('')
const nameInput = ref<HTMLInputElement>()
const form = reactive({
  label: '',
  icon: 'other',
  iconId: null as string | null,
  sortOrder: 100,
  active: true,
  pinned: false,
})
let uploadKey = createRequestId()
const viewportStyle = ref<Record<string, string>>({})
function updateViewport() {
  const v = window.visualViewport
  const height = v?.height ?? window.innerHeight
  viewportStyle.value = {
    '--category-height': `${height}px`,
    '--category-center': `${(v?.offsetTop ?? 0) + height / 2}px`,
  }
}
function stopViewport() {
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
}
onBeforeUnmount(stopViewport)
const busy = computed(
  () => uploading.value || saving.value || action.busy.value,
)
watch(busy, (value) => emit('busy', value))
watch(
  () => props.open,
  (open) => {
    stopViewport()
    if (!open) {
      return
    }
    updateViewport()
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    const c = props.category
    Object.assign(form, {
      label: c?.label ?? '',
      icon: c?.icon ?? 'other',
      iconId: c?.iconId ?? null,
      sortOrder: c?.sortOrder ?? 100,
      active: c?.active ?? true,
      pinned: c?.pinned ?? false,
    })
    preview.value = ''
    uploadKey = createRequestId()
    action.error.value = ''
  },
  { immediate: true },
)
async function focus() {
  await nextTick()
  nameInput.value?.focus()
}
function choose(icon: string) {
  form.icon = icon
  form.iconId = null
  preview.value = ''
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) {
    return
  }
  uploading.value = true
  action.error.value = ''
  try {
    const image = await categoryThumbnail(file)
    form.iconId = null
    preview.value = image
    uploadKey = createRequestId()
  } catch (e) {
    action.error.value = e instanceof Error ? e.message : '图片上传失败'
  } finally {
    uploading.value = false
  }
}
async function save() {
  if (busy.value || props.category?.isDefault) {
    return
  }
  const label = form.label.trim()
  if (!label) {
    action.error.value = '请填写分类名称'
    return
  }
  saving.value = true
  action.error.value = ''
  try {
    if (preview.value && !form.iconId) {
      const { id } = await featureApi(props.ledgerId).write<{ id: string }>(
        '/category-icons',
        { base64: preview.value.split(',')[1] },
        'POST',
        uploadKey,
      )
      form.iconId = id
    }
    const body = props.category
      ? { ...form, label }
      : { type: props.type, label, icon: form.icon, iconId: form.iconId }
    const result = await action.run(
      `category:${props.category?.id ?? 'new'}`,
      body,
      (key) =>
        featureApi(props.ledgerId).write<{ id: string }>(
          props.category ? `/categories/${props.category.id}` : '/categories',
          body,
          props.category ? 'PATCH' : 'POST',
          key,
        ),
    )
    if (result) {
      emit('saved', {
        ...props.category,
        ...form,
        id: result.id,
        type: props.category?.type ?? props.type,
        label,
        isDefault: false,
      })
      emit('close')
    }
  } catch (e) {
    action.error.value = e instanceof Error ? e.message : '分类保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal
    class="category-dialog"
    :style="viewportStyle"
    :open="open"
    :title="
      category ? '编辑分类' : `创建${type === 'income' ? '收入' : '支出'}分类`
    "
    :busy="busy"
    @close="emit('close')"
    @opened="focus"
  >
    <form class="category-form" @submit.prevent="save">
      <fieldset :disabled="busy">
        <label class="form-field"><span class="field-label">分类名称</span><input
          ref="nameInput"
          v-model="form.label"
          maxlength="40"
          required
          placeholder="例如：宠物、兼职"
        ></label>
        <div class="icon-heading">
          <span class="field-label">分类图标</span><span class="chosen-icon"><img
            v-if="preview"
            :src="preview"
            alt="所选图片"
            width="28"
            height="28"
          ><CategoryIcon
            v-else
            :ledger-id="ledgerId"
            :icon="form.icon"
            :icon-id="form.iconId"
            :size="28"
          /></span>
        </div>
        <div
          class="default-icon-grid"
          role="group"
          aria-label="选择默认分类图标"
        >
          <button
            v-for="item in defaultCategoryIcons"
            :key="item.value"
            type="button"
            :aria-label="`使用${item.label}图标`"
            :aria-pressed="!form.iconId && !preview && form.icon === item.value"
            :class="{
              selected: !form.iconId && !preview && form.icon === item.value,
            }"
            @click="choose(item.value)"
          >
            <AppIcon :name="item.value" :size="20" /><span>{{
              item.label
            }}</span>
          </button>
        </div>
        <label class="upload-icon"><AppIcon name="image" :size="17" /><span>{{
          uploading
            ? "正在处理图片…"
            : form.iconId || preview
              ? "更换上传图片"
              : "上传图片作为图标"
        }}</span><input
          class="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="上传分类图标"
          @change="upload"
        ></label>
        <p class="icon-hint">PNG、JPEG、WebP，最大 10 MB，自动压缩为图标。</p>
        <div v-if="category" class="category-options">
          <label class="form-field"><span class="field-label">排序（越小越靠前）</span><input
            v-model.number="form.sortOrder"
            type="number"
            min="0"
            max="100000"
            required
          ></label>
          <div class="category-checks">
            <label><input v-model="form.active" type="checkbox">启用分类</label><label><input v-model="form.pinned" type="checkbox">置顶分类</label>
          </div>
        </div>
        <p
          v-if="action.error.value"
          class="form-error"
          role="alert"
        >
          {{ action.error.value }}
        </p>
      </fieldset>
      <footer class="category-footer">
        <button
          class="button button-secondary"
          type="button"
          :disabled="busy"
          @click="emit('close')"
        > 取消</button><button class="button button-primary" :disabled="busy">
          {{ busy ? "正在处理…" : category ? "保存修改" : "创建分类" }}
        </button>
      </footer>
    </form>
  </Modal>
</template>

<style scoped>
.category-dialog {
  width: min(420px, calc(100% - 28px));
  position: fixed;
  top: var(--category-center, 50dvh);
  bottom: auto;
  margin: 0 auto;
  transform: translateY(-50%);
  max-height: calc(var(--category-height, 100dvh) - 28px);
  overflow: hidden;
}
.category-dialog :deep(.dialog-content) {
  padding: 20px;
  max-height: calc(var(--category-height, 100dvh) - 28px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.category-dialog :deep(.dialog-heading) {
  margin-bottom: 16px;
  flex-shrink: 0;
}
.category-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.category-form fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.category-form .form-field {
  margin: 0 0 16px;
}
.category-form .field-label {
  font-size: 12px;
  margin-bottom: 6px;
}
.category-form .form-field > input {
  min-height: 42px;
  padding: 8px 10px;
  font-size: 16px;
}
.icon-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  height: 30px;
}
.chosen-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: #edf6f3;
}
.chosen-icon img {
  object-fit: contain;
}
.default-icon-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}
.default-icon-grid button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px 2px;
  border: 1px solid #e7edeb;
  border-radius: 8px;
  background: #f8faf9;
  color: #708078;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.default-icon-grid button.selected {
  color: var(--accent);
  border-color: #96c5b8;
  background: #edf6f3;
}
.upload-icon {
  display: flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  border: 1px dashed #c9d7d2;
  border-radius: 8px;
  min-height: 40px;
  margin-top: 12px;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}
.icon-hint {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  margin: 7px 0 0;
}
.category-options {
  margin-top: 18px;
}
.category-checks {
  display: flex;
  gap: 20px;
  font-size: 12px;
}
.category-checks label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.category-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid #edf1ef;
}
.category-footer .button {
  min-height: 40px;
  font-size: 13px;
}
.category-footer .button-primary {
  flex: 1;
}
.default-icon-grid button:focus-visible,
.upload-icon:focus-within {
  outline: 2px solid var(--focus-border);
  outline-offset: 2px;
}
</style>
