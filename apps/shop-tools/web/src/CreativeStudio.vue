<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { Creation, CreativeInput, CreativeRules, CreativeTemplate, ProjectSummary } from '@t-box/shop-tools-contracts'
import { parseCreativeInput, parseTemplates } from '@t-box/shop-tools-core'
import { AppIcon, Modal, SheetSelect } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import EditDialog from './EditDialog.vue'

const props = defineProps<{ client: AppClient, project: ProjectSummary, templates: CreativeTemplate[], visible: boolean }>()
const emit = defineEmits<{ templates: [templates: CreativeTemplate[]] }>()
const fields = ['title', 'description', 'image'] as const
const labels = { title: '标题', description: '描述', image: '图片' }
const hints = { title: '例如：保留品牌和型号，80 字以内', description: '例如：按材质、尺寸、使用场景分点写', image: '例如：白底主图，保留包装，图中文字改为英文' }
const defaults = (): CreativeRules => ({ title: '', description: '', image: '', language: '' })
const rules = ref(defaults())
const selected = ref<CreativeInput['fields']>(['title', 'description'])
const title = ref('')
const description = ref('')
const imageId = ref('')
const sourceUrl = ref('')
const resultUrl = ref('')
const originalUrl = ref('')
const chosen = ref('')
const templatesOpen = ref(false)
const removing = ref<CreativeTemplate | null>(null)
const draft = ref<CreativeTemplate | null>(null)
const result = ref<Creation | null>(null)
const readOnly = computed(() => props.project.role === 'viewer')
const error = ref('')
const busy = ref(false)
const options = computed(() => [{ label: '自定义要求', value: '' }, ...props.templates.map((t) => ({ label: t.name, value: t.id }))])
type Summary = Pick<Creation, 'id' | 'createdAt' | 'status' | 'errors'> & { title: string, language: string }
const history = ref<Summary[]>([])
const pending = computed(() => history.value.some((item) => item.status === 'running'))
function apply(id: string) {
  chosen.value = id
  const t = props.templates.find((t) => t.id === id)
  rules.value = t ? { title: t.title, description: t.description, image: t.image, language: t.language } : defaults()
}
function edit(t?: CreativeTemplate) {
  draft.value = t ? { ...t } : { ...rules.value, id: crypto.randomUUID(), name: '' }
  error.value = ''
}
function deleteTemplate() {
  if (readOnly.value || !removing.value) {
    return
  }
  const id = removing.value.id
  emit('templates', props.templates.filter((t) => t.id !== id))
  if (chosen.value === id) {
    chosen.value = ''
  }
  removing.value = null
}
function saveTemplate() {
  if (!draft.value || readOnly.value) {
    return
  }
  const value = { ...draft.value }
  try {
    const all = props.templates.filter((t) => t.id !== value.id)
    emit('templates', parseTemplates([...all, value]))
    chosen.value = value.id
    rules.value = { title: value.title, description: value.description, image: value.image, language: value.language }
    draft.value = null
  } catch (e) {
    error.value = String(e)
  }
}
function call<T>(action: string, extra: Record<string, unknown> = {}) {
  return props.client.api.invoke<T>('creative', { projectId: props.project.id, action, ...extra })
}
function replaceUrl(slot: typeof sourceUrl, value: string) {
  if (slot.value) {
    URL.revokeObjectURL(slot.value)
  }
  slot.value = value
}
let live = true
let timer: ReturnType<typeof setTimeout>
let version = 0
async function preview(id: string) {
  const token = ++version
  try {
    const rec = await call<Creation | null>('get', { id })
    if (!live || token !== version || !rec) {
      return
    }
    result.value = rec
    replaceUrl(resultUrl, '')
    replaceUrl(originalUrl, '')
    await Promise.all(([[rec.input.imageId, originalUrl], [rec.output.image, resultUrl]] as const).map(async ([file, slot]) => {
      if (!file) {
        return
      }
      const data = await props.client.files.read(file)
      if (live && token === version) {
        replaceUrl(slot, URL.createObjectURL(data.blob))
      }
    }))
  } catch (e) {
    if (live) {
      error.value = String(e)
    }
  }
}
async function refresh() {
  clearTimeout(timer)
  try {
    history.value = await call<Summary[]>('history')
    if (!live) {
      return
    }
    const updated = history.value.find((item) => item.id === result.value?.id)
    if (updated?.status === 'finished' && result.value?.status === 'running') {
      await preview(updated.id)
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    clearTimeout(timer)
    if (live && props.visible && pending.value) {
      timer = setTimeout(refresh, 2500)
    }
  }
}
watch(() => props.visible, (visible) => {
  if (visible) {
    void refresh()
  } else {
    clearTimeout(timer)
  }
}, { immediate: true })
onBeforeUnmount(() => {
  live = false
  clearTimeout(timer)
  for (const slot of [sourceUrl, resultUrl, originalUrl]) {
    replaceUrl(slot, '')
  }
})
function reuseOriginal() {
  if (!result.value || readOnly.value) {
    return
  }
  const input = result.value.input
  title.value = input.title
  description.value = input.description
  imageId.value = input.imageId
  replaceUrl(sourceUrl, originalUrl.value)
  originalUrl.value = ''
  selected.value = [...input.fields]
  rules.value = { ...input.rules }
  chosen.value = ''
  version++
  result.value = null
}
function removeImage() {
  imageId.value = ''
  replaceUrl(sourceUrl, '')
  selected.value = selected.value.filter((field) => field !== 'image')
}
async function upload(event: Event) {
  const el = event.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('请选择 JPG、PNG 或 WebP 图片')
    }
    const saved = await props.client.files.upload(file)
    if (!live) {
      return
    }
    imageId.value = saved.id
    replaceUrl(sourceUrl, URL.createObjectURL(file))
    if (!selected.value.includes('image')) {
      selected.value.push('image')
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
let submission: { payload: string, key: string } | undefined
async function generate() {
  if (busy.value || readOnly.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const input = parseCreativeInput({ title: title.value, description: description.value, imageId: imageId.value, fields: selected.value, rules: rules.value })
    const payload = JSON.stringify(input)
    if (submission?.payload !== payload) {
      submission = { payload, key: crypto.randomUUID() }
    }
    const job = await props.client.api.invoke<{ id: string }>('creative', { projectId: props.project.id, action: 'create', input }, { idempotencyKey: submission.key })
    submission = undefined
    await preview(job.id)
    await refresh()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="shop-content creative-studio">
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <div v-if="!readOnly" class="desk">
      <section class="manuscript">
        <header class="studio-heading"><AppIcon name="file" /><h2>商品原稿</h2></header>
        <div class="paper">
          <label class="paper-field">原标题<input v-model="title" maxlength="1000" placeholder="输入商品标题"></label>
          <label class="paper-field">原描述<textarea v-model="description" rows="5" maxlength="12000" placeholder="粘贴商品描述、规格或卖点…" /></label>
        </div>
        <div class="attachment">
          <label class="upload">
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="商品原图" :disabled="busy" @change="upload">
            <img v-if="sourceUrl" :src="sourceUrl" alt="待优化商品图片">
            <span v-else class="image-mark"><AppIcon name="image" :size="22" /></span>
            <span><strong>{{ sourceUrl ? '更换商品原图' : '添加商品原图' }}</strong><small>JPG、PNG 或 WebP</small></span>
          </label>
          <button v-if="sourceUrl" @click="removeImage">移除</button>
        </div>
      </section>
      <section class="recipe">
        <header class="studio-heading"><AppIcon name="settings" /><h2>创作设置</h2><button class="quiet" @click="templatesOpen = true">项目模板</button></header>
        <div class="settings-pair">
          <div class="setting"><span>创作模板</span><SheetSelect :model-value="chosen" :options="options" label="选择模板" desktop-modal @update:model-value="apply" /></div>
          <label class="setting">输出语言<input v-model="rules.language" maxlength="50" placeholder="沿用原文"></label>
        </div>
        <fieldset class="outputs"><legend>优化内容</legend>
          <label v-for="f in fields" :key="f" :class="{ included: selected.includes(f) }">
            <input v-model="selected" type="checkbox" :value="f"><AppIcon :name="selected.includes(f) ? 'check' : 'plus'" :size="14" />{{ labels[f] }}
          </label>
        </fieldset>
        <details class="custom-rules">
          <summary>分项要求<span>{{ selected.filter(f => rules[f].trim()).length ? '已自定义' : '默认' }}<AppIcon name="down" :size="14" /></span></summary>
          <label v-for="f in selected" :key="f" class="setting">{{ labels[f] }}要求<textarea v-model="rules[f]" rows="2" maxlength="1000" :placeholder="hints[f]" /></label>
          <p v-if="!selected.length">请先选择要优化的内容。</p>
        </details>
        <footer class="studio-actions"><button class="quiet" @click="edit()"><AppIcon name="copy" :size="15" />存为模板</button>
          <button class="primary" :disabled="busy || pending || !selected.length" @click="generate"><AppIcon name="sparkle" :size="16" />{{ pending ? '正在创作…' : '一键优化' }}</button></footer>
      </section>
    </div>
    <div v-else class="readonly-tools"><button @click="templatesOpen = true">项目模板</button></div>
    <section class="past"><div class="studio-heading"><AppIcon name="history" /><h2>我的创作记录</h2><button class="quiet" @click="refresh"><AppIcon name="refresh" :size="14" />刷新</button></div>
      <p v-if="!history.length" class="empty-history">完成优化后，可在这里查看原稿与各次创作结果。</p>
      <div
        v-for="item in history"
        :key="item.id"
        class="site-row"
      ><div><strong>{{ item.title }}</strong><small>{{ item.language || '原文语言' }} · {{ new Date(item.createdAt).toLocaleString() }} · {{ item.status === 'running' ? '生成中' : item.errors.length ? '查看处理结果' : '已完成' }}</small></div><button @click="preview(item.id)">查看</button></div>
    </section>
    <Modal
      :open="!!result"
      title="创作版本"
      class="shop-dialog shop-dialog-long"
      @close="version++; result = null"
    >
      <div v-if="result" class="shop-dialog-body creative-result"><small>{{ result.input.rules.language || '原文语言' }} · {{ new Date(result.createdAt).toLocaleString() }}</small>
        <p v-if="result.status === 'running'" role="status">正在生成，完成后自动更新。</p><p
          v-for="msg in result.errors"
          :key="msg"
          class="notice error"
        >{{ msg }}</p>
        <details><summary>查看商品原稿</summary><strong>{{ result.input.title }}</strong><p>{{ result.input.description }}</p><img
          v-if="originalUrl"
          :src="originalUrl"
          alt="原图"
        ></details>
        <label v-if="result.output.title" class="field">优化后标题<textarea readonly :value="result.output.title" /></label>
        <label v-if="result.output.description" class="field">优化后描述<textarea
          readonly
          rows="8"
          :value="result.output.description"
        /></label>
        <div v-if="resultUrl"><img :src="resultUrl" alt="优化后商品图"><a :href="resultUrl" download="商品优化图.png">下载图片</a></div>
      </div>
      <template #footer><button
        v-if="!readOnly && result"
        :disabled="!!result.input.imageId && !originalUrl"
        @click="reuseOriginal"
      >使用原稿再创作</button></template>
    </Modal>
    <Modal
      :open="templatesOpen"
      title="项目创作模板"
      class="shop-dialog"
      @close="templatesOpen = false"
    ><div class="shop-dialog-body">
      <button v-if="!readOnly" @click="edit()">新建模板</button><p v-if="!templates.length">暂无模板</p>
      <div
        v-for="t in templates"
        :key="t.id"
        class="site-row"
      ><strong>{{ t.name }}</strong><div class="actions"><button v-if="!readOnly" @click="edit(t)">编辑</button><button v-if="!readOnly" @click="removing = t">删除</button><button v-if="!readOnly" @click="apply(t.id); templatesOpen = false">使用模板</button></div></div>
    </div></Modal>
    <Modal
      :open="!!removing"
      title="删除模板"
      class="shop-dialog"
      @close="removing = null"
    >
      <p class="shop-dialog-body">确认删除「{{ removing?.name }}」？已有创作记录会保留。</p>
      <template #footer><button @click="removing = null">取消</button><button @click="deleteTemplate">删除模板</button></template>
    </Modal>
    <EditDialog
      :open="!!draft"
      long
      :title="templates.some(t => t.id === draft?.id) ? '编辑模板' : '新建模板'"
      @save="saveTemplate"
      @close="draft = null"
    ><div v-if="draft" class="template-form">
      <p v-if="error" role="alert">{{ error }}</p><label class="field">模板名称<input v-model="draft.name" maxlength="80"></label><label class="field">输出语言<input v-model="draft.language" maxlength="50"></label>
      <label
        v-for="f in fields"
        :key="f"
        class="field"
      >{{ labels[f] }}要求<textarea
        :placeholder="hints[f]"
        v-model="draft[f]"
        maxlength="1000"
        rows="3"
      /></label>
    </div></EditDialog>
  </main>
</template>

<style scoped>
.creative-studio {
  --edge: #dbe2e7;
  --paper-ink: #233342;
  display: grid;
  align-content: start;
  gap: 22px;
  max-width: 1160px;
  padding-block: clamp(16px, 3vw, 40px);
  color: var(--paper-ink);
}
.desk { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); background: white; border: 1px solid var(--edge); border-radius: 16px; overflow: hidden; box-shadow: 0 5px 20px #24344208; }
.manuscript, .recipe { min-width: 0; padding: clamp(18px, 2.5vw, 34px); display: flex; flex-direction: column; gap: 22px; }
.recipe { background: #fbfcfd; border-left: 1px solid var(--edge); }
.studio-heading, .attachment, .upload, .studio-actions, .studio-actions button, .quiet, .custom-rules summary span { display: flex; align-items: center; gap: 9px; }
.studio-heading > svg { color: #667988; }
.studio-heading h2 { font-size: 16px; font-weight: 650; letter-spacing: .02em; }
.studio-heading .quiet { margin-left: auto; }
.quiet { background: transparent; border: 0; padding: 4px; color: #556773; font-size: 12px; }
.paper { flex: 1; display: flex; flex-direction: column; gap: 17px; }
.paper-field, .setting, .template-form .field { display: grid; gap: 7px; color: #556773; font-size: 12px; font-weight: 500; }
.paper-field:first-child { padding-bottom: 14px; border-bottom: 1px solid var(--edge); }
.paper-field input, .paper-field textarea { width: 100%; padding: 3px 0; border: 0; border-radius: 0; background: transparent; color: var(--paper-ink); }
.paper-field input { line-height: 1.45; font-family: inherit; font-size: clamp(17px,1.5vw,21px); font-weight: 600; }
.paper-field textarea, .setting textarea, .template-form textarea, .creative-result textarea { font: inherit; font-size: 13px; line-height: 1.7; resize: vertical; }
.paper-field textarea { min-height: 64px; }
.attachment { background: #f5f7f8; border: 1px dashed #c6d1d8; border-radius: 10px; padding: 11px 13px; }
.upload { flex: 1; position: relative; cursor: pointer; }
.upload input, .outputs input { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
.upload:focus-within, .outputs label:focus-within { outline: 2px solid var(--accent); outline-offset: 3px; }
.image-mark, .upload img { width: 40px; height: 40px; border-radius: 8px; }
.image-mark { display: grid; place-items: center; color: #607788; background: #e5ebef; }
.upload img { object-fit: cover; }
.upload small { font-size: 11px; }
.settings-pair, .template-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.setting input, .setting textarea, .template-form input, .template-form textarea, .creative-result textarea { width: 100%; min-width: 0; color: var(--paper-ink); background: #fff; border: 1px solid var(--edge); border-radius: 7px; padding: 8px 10px; }
.setting input, .setting :deep(.sheet-select-trigger) { min-height: 38px; font-size: 13px; }
.outputs { margin: 0; padding: 0; border: 0; display: flex; flex-wrap: wrap; gap: 7px; }
.outputs legend { margin-bottom: 7px; padding: 0; color: #556773; font-size: 12px; }
.outputs label { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--edge); border-radius: 18px; color: #647481; background: white; cursor: pointer; }
.outputs label.included { background: #fff1ea; border-color: #efbea9; color: #994024; }
.custom-rules { border-block: 1px solid var(--edge); padding: 12px 0; }
.custom-rules summary { display: flex; justify-content: space-between; align-items: center; cursor: pointer; list-style: none; }
.custom-rules summary::-webkit-details-marker { display: none; }
.custom-rules summary span { font-size: 12px; color: #68788a; }
.custom-rules[open] summary svg { transform: rotate(180deg); }
.custom-rules .setting { margin-top: 12px; }
.studio-actions { margin-top: auto; justify-content: space-between; }
.studio-actions .primary { padding: 9px 20px; border-radius: 8px; font-weight: 600; }
.past { padding: 18px 24px; background: white; border: 1px solid var(--edge); border-radius: 12px; }
.empty-history { margin: 10px 0 0 29px; color: var(--muted); font-size: 12px; }
.template-form { gap: 16px; }
.template-form > :nth-last-child(-n+3), .template-form > p { grid-column: 1/-1; }
.creative-result img { display: block; max-width: 100%; max-height: 260px; object-fit: contain; }
@media(max-width: 740px) {
  .creative-studio { gap: 12px; }
  .desk { grid-template-columns: minmax(0,1fr); }
  .manuscript, .recipe { padding: 16px; gap: 14px; }
  .recipe { border-left: 0; border-top: 1px solid var(--edge); }
  .paper { gap: 12px; }
  .paper-field textarea { height: 68px; }
  .past { padding: 14px 16px; }
  .studio-heading h2 { font-size: 15px; }
}
</style>
