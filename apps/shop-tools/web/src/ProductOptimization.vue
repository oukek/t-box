<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { CatalogVersion, OptimizationJob, OptimizationSlot, ProjectPrompt, ProjectSummary } from '@t-box/shop-tools-contracts'
import { clone, optimizationSlots } from '@t-box/shop-tools-core'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CatalogImage from './CatalogImage.vue'

const props = defineProps<{ client: AppClient, version: CatalogVersion, project: ProjectSummary, productId: string }>()
const emit = defineEmits<{ apply: [value: { id: string }] }>()
const original = ref(clone(props.version.content))
const modeOptions = [{ value: 'optimize', label: '优化' }, { value: 'keep', label: '保留原样' }, { value: 'remove', label: '从新版本删除' }]
const slots = ref(optimizationSlots(original.value))
const textItems = computed(() => slots.value.filter((s) => !s.skuId && s.kind === 'text'))
const skus = computed(() => slots.value.filter((s) => s.kind === 'text' && s.skuId))
const images = computed(() => slots.value.filter((s) => s.kind === 'image'))
const promptOpen = ref(false)
const step = ref('prepare')
const section = ref('text')
const page = ref(0)
watch(section, () => page.value = 0)
const extra = ref('')
const saved = ref(false)
const busy = ref(false)
const error = ref('')
const saveError = ref('')
const loaded = ref(false)
const rules = ref<ProjectPrompt>({ language: '', prompt: '', revision: 0 })
const job = ref<OptimizationJob>()
const edits = ref<Record<string, string>>({})
const recent = ref<{ id: string, status: string, appliedVersion: string | null }[]>([])
const running = computed(() => job.value?.status === 'running')
const effective = (a: OptimizationSlot) => a.skuId && skus.value.find((s) => s.skuId === a.skuId)?.mode === 'remove' ? 'remove' : a.mode
const rows = computed(() => slots.value.map((a) => ({ ...a, mode: effective(a) })))
const optimizeCount = computed(() => rows.value.filter((a) => a.mode === 'optimize').length)
const pageCount = computed(() => Math.max(1, Math.ceil((step.value === 'prepare' ? (section.value === 'text' ? 0 : section.value === 'images' ? images.value.length : skus.value.length) : Math.max(images.value.length, skus.value.length)) / 20)))
const removeCount = computed(() => rows.value.filter((a) => a.mode === 'remove').length)
const progress = computed(() => Object.values(job.value?.results || {}).filter((r) => r.status === 'complete').length)
const failed = computed(() => Object.entries(job.value?.results || {}).filter(([,r]) => r.status === 'failed').map(([id]) => id))
let disposed = false
let timer: ReturnType<typeof setTimeout> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveChain = Promise.resolve()
let startKey = ''
function call<T>(action: string, args: Record<string, unknown> = {}, key?: string) {
  return props.client.api.invoke<T>('catalog', { action, projectId: props.project.id, productId: props.productId, ...args }, key ? { idempotencyKey: key } : undefined)
}
async function run(fn: () => Promise<void>) {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
function saveRules() {
  clearTimeout(saveTimer)
  saveChain = saveChain.catch(() => {}).then(async () => {
    if (saved.value) {
      return
    }
    const value = { language: rules.value.language, prompt: rules.value.prompt }
    const next = await call<ProjectPrompt>('ai-save-settings', { revision: rules.value.revision, rules: value })
    rules.value.revision = next.revision
    saved.value = value.language === rules.value.language && value.prompt === rules.value.prompt
    saveError.value = ''
  })
  return saveChain.catch((e) => {
    saveError.value = '项目要求未保存：' + String(e)
    throw e
  })
}
watch(() => [rules.value.language, rules.value.prompt], () => {
  if (!loaded.value) {
    return
  }
  saved.value = false
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveRules().catch(() => {})
  }, 600)
})
async function closeSettings() {
  await run(async () => {
    await saveRules()
    promptOpen.value = false
  })
}
async function poll(id: string) {
  try {
    const value = await call<OptimizationJob>('ai-get', { jobId: id })
    if (disposed) {
      return
    }
    if (job.value?.id !== value.id) {
      edits.value = {}
    }
    job.value = clone(value)
    slots.value = clone(value.snapshot.slots)
    original.value = clone(value.snapshot.source)
    extra.value = value.snapshot.supplement
    step.value = value.status === 'running' ? 'running' : 'review'
    if (value.status === 'running') {
      timer = setTimeout(() => void poll(id), 2000)
    } else {
      for (const s of value.snapshot.slots) {
        if (s.kind === 'text' && s.mode !== 'remove' && (s.mode === 'keep' || value.results[s.id]?.status === 'complete') && edits.value[s.id] === undefined) {
          edits.value[s.id] = s.mode === 'keep' ? s.text || '' : value.results[s.id]?.text || ''
        }
      }
    }
  } catch (e) {
    error.value = String(e)
  }
}
async function generate() {
  await run(async () => {
    await saveRules()
    startKey ||= crypto.randomUUID()
    const result = await call<{ id: string }>('ai-start', { versionId: props.version.id, revision: props.version.revision, rulesRevision: rules.value.revision, choices: Object.fromEntries(slots.value.map((s) => [s.id, { mode: s.mode, ...(s.kind === 'text' ? { text: s.text } : {}) }])), supplement: extra.value }, startKey)
    await poll(result.id)
  })
}
async function retry() {
  await run(async () => {
    await call('ai-retry', { jobId: job.value!.id, ids: failed.value }, crypto.randomUUID())
    await poll(job.value!.id)
  })
}
async function confirm() {
  await run(async () => {
    const result = await call<{ id: string }>('ai-apply', { jobId: job.value!.id, edits: edits.value }, job.value!.id + '-apply')
    emit('apply', result)
  })
}
function prepare() {
  job.value = undefined
  edits.value = {}
  slots.value = optimizationSlots(props.version.content)
  original.value = clone(props.version.content)
  step.value = 'prepare'
  page.value = 0
  startKey = ''
}
watch([slots, extra], () => {
  if (step.value === 'prepare') {
    startKey = ''
  }
}, { deep: true })
onMounted(() => run(async () => {
  rules.value = await call<ProjectPrompt>('ai-settings')
  await Promise.resolve()
  loaded.value = true
  saved.value = true
  recent.value = await call('ai-list')
}))
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  clearTimeout(saveTimer)
  if (loaded.value && !saved.value) {
    void saveRules().catch(() => {})
  }
})
defineExpose({ flush: async () => {
  if (loaded.value && !saved.value) {
    await saveRules()
  }
} })
</script>

<template>
  <div class="design-ai">
    <nav class="ai-steps"><span :class="{ current: step === 'prepare' }">1 准备素材</span><span :class="{ current: step === 'running' }">2 自动优化</span><span :class="{ current: step === 'review' }">3 对照确认</span></nav>
    <div class="ai-rule-summary"><div><strong>{{ project.name }} · {{ job?.snapshot.rules.language || rules.language }}</strong><p>{{ job?.snapshot.rules.prompt || rules.prompt }}</p><small>{{ saved ? '项目要求已自动记录，下次沿用' : '要求随项目记录' }} · 不影响其他项目</small></div><button :disabled="running || step === 'review'" @click="promptOpen = true">调整项目要求</button></div>
    <p v-if="error || saveError" role="alert">{{ error || saveError }}</p><button
      v-if="error && job"
      :disabled="busy"
      @click="run(() => poll(job!.id))"
    >重新读取任务</button><div v-if="step === 'prepare' && recent.length" class="toolbar"><span>最近优化任务</span><button
      v-for="r in recent"
      :key="r.id"
      :disabled="busy"
      @click="run(() => poll(r.id))"
    >{{ r.appliedVersion ? '查看已创建版本的任务' : r.status === 'running' ? '继续查看进度' : '查看结果' }}</button></div>
    <template v-if="step === 'prepare'">
      <div class="ai-layout"><aside><button :class="{ active: section === 'text' }" @click="section = 'text'">标题与描述 <small>2</small></button><button :class="{ active: section === 'images' }" @click="section = 'images'">商品与规格图片 <small>{{ images.length }}</small></button><button :class="{ active: section === 'skus' }" @click="section = 'skus'">SKU 与规格 <small>{{ skus.length }}</small></button><p>原版本保持不变。删除项只从新版本移除；删除 SKU 会同时移除它的规格图片。</p><small>视频 {{ original.videos?.length || 0 }} 个 · 原样保留</small></aside>
        <main class="ai-assets">
          <template v-if="section === 'text'"><article
            v-for="t in textItems"
            :key="t.id"
            :class="{ removed: t.mode === 'remove' }"
          ><div class="ai-row-head"><strong>{{ t.label }}</strong><SheetSelect
            v-model="t.mode"
            :options="t.id === 'title' ? modeOptions.slice(0, 2) : modeOptions"
            :label="t.label + '处理方式'"
            desktop-modal
          /></div><FormControl
            v-model="t.text"
            multiline
            :rows="t.id === 'title' ? 2 : 5"
            :readonly="t.mode !== 'optimize'"
            :aria-label="t.label + '原稿'"
          /><small>原位置：{{ t.id === 'title' ? '商品标题' : '商品描述' }} · 结果回填到同一字段</small></article></template>
          <div v-if="section === 'images'" class="ai-image-grid"><article
            v-for="a in images.slice(page * 20, (page + 1) * 20)"
            :key="a.id"
            :class="{ removed: effective(a) === 'remove' }"
          ><CatalogImage
            :client="client"
            :project-id="project.id"
            :product-id="productId"
            :asset="a.asset!"
            :alt="a.label"
          /><strong>{{ a.label }}</strong><small>原位置 {{ a.position + 1 }} · {{ a.skuId ? '所属 SKU：' + skus.find((s: OptimizationSlot) => s.skuId === a.skuId)?.text : '商品图片' }} </small><SheetSelect
            v-model="a.mode"
            :options="modeOptions"
            :label="a.label + '处理方式'"
            :disabled="effective(a) === 'remove' && a.mode !== 'remove'"
            desktop-modal
          /><small v-if="effective(a) === 'remove'">将在新版本移除</small></article></div>
          <template v-if="section === 'skus'"><article
            v-for="s in skus.slice(page * 20, (page + 1) * 20)"
            :key="s.id"
            :class="{ removed: s.mode === 'remove' }"
          ><div class="ai-row-head"><div><strong>{{ s.text }}</strong><small>来源 SKU：{{ original.skus.find(x => x.id === s.skuId)?.sourceSkuId || '自定义' }} · 自有编码：{{ original.skus.find(x => x.id === s.skuId)?.code || '未填写' }}</small></div><SheetSelect
            v-model="s.mode"
            :options="modeOptions"
            :label="s.text + '处理方式'"
            desktop-modal
          /></div><p>{{ images.filter(a => a.skuId === s.skuId).length }} 张图片与此 SKU 绑定；翻译名称不会改变编码、成本、售价和图片归属。</p></article></template>
        </main></div>
      <label class="ai-extra">本次补充要求（仅用于此任务）<FormControl
        v-model="extra"
        placeholder="例如：此款突出旅行场景，主图不加文字"
        multiline
        rows="2"
      /></label>
    </template>
    <section v-if="step === 'running'" class="ai-progress"><h3>正在按项目要求优化</h3><p>文案与图片分别处理，按原位置回填。</p><progress :value="progress" :max="optimizeCount" /><strong>{{ progress }} / {{ optimizeCount }} 项已完成</strong><p>项目要求已保存为本次任务快照。</p></section>
    <template v-if="step === 'review'"><div class="ai-review-heading"><strong>{{ failed.length ? '部分项目失败，重试后确认' : '优化完成' }} · {{ progress }} / {{ optimizeCount }} 项完成，{{ removeCount }} 项删除</strong><span>目标语言：{{ job?.snapshot.rules.language }}</span></div>
      <div class="ai-compare-head"><span>原内容</span><span>新版本内容（可调整）</span></div>
      <article
        v-for="t in textItems"
        :key="t.id"
        class="ai-compare"
      ><div><strong>{{ t.label }}</strong><p>{{ t.text }}</p></div><div><p v-if="job?.results[t.id]?.error" role="alert">{{ job.results[t.id]?.error }}</p><small>{{ t.mode === 'remove' ? '已删除' : t.mode === 'keep' ? '保留原样' : '已优化' }}</small><FormControl
        v-if="t.mode !== 'remove'"
        v-model="edits[t.id]"
        :readonly="!!job?.appliedVersion"
        multiline
        :rows="t.id === 'title' ? 2 : 4"
        :aria-label="'优化后' + t.label"
      /></div></article>
      <article
        v-for="s in skus.slice(page * 20, (page + 1) * 20)"
        :key="s.id"
        class="ai-compare"
      ><div><strong>SKU：{{ s.text }}</strong><small>{{ s.skuId }}</small></div><div v-if="s.mode !== 'remove'"><p v-if="job?.results[s.id]?.error" role="alert">{{ job.results[s.id]?.error }}</p><FormControl
        v-model="edits[s.id]"
        :readonly="!!job?.appliedVersion"
        aria-label="优化后规格名称"
      /><small>原 SKU 与对应图片保持关联 · {{ images.filter(a => a.skuId === s.skuId && effective(a) !== 'remove').length }} 张图片</small></div><div v-else class="ai-deleted">此 SKU 及其图片从新版本删除</div></article>
      <details class="ai-image-review"><summary>查看 {{ images.length }} 张图片的位置与对照</summary><div
        v-for="a in images.slice(page * 20, (page + 1) * 20)"
        :key="a.id"
        class="ai-compare"
      ><div><CatalogImage
        :client="client"
        :project-id="project.id"
        :product-id="productId"
        :asset="a.asset!"
        :alt="a.label"
      /><small>{{ a.label }} · 原位置 {{ a.position + 1 }}</small></div><div><CatalogImage
        v-if="effective(a) !== 'remove' && (a.mode === 'keep' || job?.results[a.id]?.fileId)"
        :client="client"
        :project-id="project.id"
        :product-id="productId"
        :asset="{ ...a.asset!, ...(a.mode === 'optimize' ? { fileId: job?.results[a.id]?.fileId } : {}) }"
        :alt="a.label + '优化结果'"
      /><p v-if="job?.results[a.id]?.error" role="alert">{{ job.results[a.id]?.error }}</p><small>{{ effective(a) === 'remove' ? '已删除' : effective(a) === 'keep' ? '保留原图' : '已优化 · 回填原位置' }}</small></div></div></details>
    </template>
    <div v-if="step !== 'running' && pageCount > 1" class="toolbar"><button :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pageCount }} 页</span><button :disabled="page + 1 >= pageCount" @click="page++">下一页</button></div>
    <footer class="ai-footer"><span v-if="step === 'prepare'">{{ optimizeCount }} 项待优化 · {{ removeCount }} 项将在新版本删除</span><span v-else-if="step === 'review'">确认后创建新版本，原版本保留。</span><span v-else>任务正在后台处理，关闭后可继续查看。</span><button
      v-if="step === 'review'"
      :disabled="busy"
      @click="prepare"
    >返回调整</button><button
      v-if="step === 'prepare'"
      class="primary"
      :disabled="busy || !loaded || !optimizeCount || !skus.some(s => s.mode !== 'remove')"
      @click="generate"
    >开始自动优化</button><button
      v-if="step === 'review' && failed.length"
      :disabled="busy"
      @click="retry"
    >重试 {{ failed.length }} 个失败项</button><button
      v-if="step === 'review'"
      class="primary"
      :disabled="busy || failed.length > 0 || !edits.title?.trim()"
      @click="confirm"
    >{{ job?.appliedVersion ? '查看已创建版本' : '确认创建新版本' }}</button></footer>
  </div>
  <Modal
    class="ai-project-settings"
    :open="promptOpen"
    title="项目优化要求"
    @close="closeSettings"
  ><p>适用于 {{ project.name }}，修改后自动记录。</p><label>目标语言<SheetSelect
    v-model="rules.language"
    :options="['马来语', '英语', '泰语', '繁体中文', '印尼语', '越南语', '葡萄牙语', '菲律宾语'].map(value => ({ value, label: value }))"
    label="目标语言"
    desktop-modal
  /></label><label>文案与图片要求<FormControl
    v-model="rules.prompt"
    multiline
    rows="8"
  /></label><p v-if="saveError" role="alert">{{ saveError }}</p><button
    v-if="saveError"
    :disabled="busy"
    @click="run(async() => { rules = await call('ai-settings');saveError = '';saved = true })"
  >重新载入服务端要求（覆盖当前输入）</button><p>{{ saved ? '已自动记录' : '在此配置项目的统一风格' }}</p><template #footer><button :disabled="busy" @click="closeSettings">完成</button></template></Modal>
</template>

<style>
.dialog:has(.design-ai) {
  width: min(1180px, calc(100vw - 48px)) !important;
}
.design-ai {
  padding: 18px 22px;
  font-size: 13px;
  color: #24384b;
}
.ai-steps {
  display: flex;
  gap: 36px;
  padding: 4px 0 18px;
  border-bottom: 1px solid #dde5ee;
  color: #718092;
}
.ai-steps .current {
  color: #d74720;
  font-weight: 650;
}
.ai-rule-summary {
  display: flex;
  gap: 24px;
  align-items: center;
  padding: 16px;
  background: #f5f8fb;
  margin-top: 16px;
  border-radius: 8px;
}
.ai-rule-summary > div {
  flex: 1;
}
.ai-rule-summary p {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  margin: 6px 0;
  line-height: 1.7;
}
.design-ai small {
  display: block;
  color: #738397;
  font-size: 11px;
  line-height: 1.6;
}
.ai-demo {
  color: #8a672e;
  font-size: 12px;
  margin: 12px 0;
}
.ai-layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  border: 1px solid #dde5ee;
  border-radius: 8px;
  min-height: 340px;
  overflow: hidden;
}
.ai-layout aside {
  padding: 14px;
  background: #f8fafc;
  border-right: 1px solid #dde5ee;
}
.ai-layout aside button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  text-align: left;
}
.ai-layout aside button.active {
  border-color: #d74720;
  color: #d74720;
  background: #fff6f2;
}
.ai-layout aside p {
  line-height: 1.8;
  font-size: 12px;
  color: #738397;
  margin-top: 24px;
}
.ai-assets {
  padding: 16px;
  min-width: 0;
}
.ai-assets article {
  padding: 12px;
  border: 1px solid #e0e7ee;
  border-radius: 7px;
  margin-bottom: 12px;
}
.ai-row-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.ai-row-head strong {
  flex: 1;
}
.ai-row-head > div {
  flex: 1;
}
.ai-row-head > button {
  max-width: 170px;
}
.ai-image-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ai-image-grid article {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-image-grid img {
  width: 100%;
  height: 140px;
  object-fit: contain;
  background: #f5f7f8;
}
.ai-sku-image {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 5px;
}
.design-ai .removed {
  opacity: 0.55;
  background: #f5f5f5;
}
.ai-extra {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.ai-footer {
  position: sticky;
  bottom: -20px;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px 0;
  background: white;
  border-top: 1px solid #dfe7ee;
  margin-top: 16px;
  z-index: 2;
}
.ai-footer > span {
  flex: 1;
  color: #687c8f;
}
.ai-progress {
  text-align: center;
  padding: 65px 25px;
  display: grid;
  gap: 16px;
  justify-items: center;
}
.ai-progress progress {
  width: 70%;
  accent-color: #d74720;
}
.ai-review-heading {
  display: flex;
  justify-content: space-between;
  margin: 20px 0;
}
.ai-compare-head,
.ai-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.ai-compare-head {
  padding: 12px;
  background: #f1f5f9;
  font-weight: 600;
}
.ai-compare {
  padding: 16px 12px;
  border-bottom: 1px solid #dde5ee;
}
.ai-compare p {
  white-space: pre-wrap;
  line-height: 1.8;
}
.ai-compare > div {
  min-width: 0;
}
.ai-compare small {
  margin-top: 8px;
}
.ai-deleted {
  color: #b45336;
}
.ai-image-review summary {
  padding: 16px;
  cursor: pointer;
}
.ai-image-review img {
  width: 160px;
  height: 160px;
  object-fit: contain;
}
@media (max-width: 700px) {
  .ai-layout {
    grid-template-columns: 1fr;
  }
  .ai-layout aside {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ai-layout aside p {
    display: none;
  }
  .ai-image-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .ai-rule-summary {
    flex-wrap: wrap;
  }
  .ai-steps {
    gap: 12px;
  }
  .ai-compare {
    gap: 12px;
  }
}
.design-ai textarea,
.ai-project-settings textarea {
  width: 100%;
  box-sizing: border-box;
}
.ai-project-settings label {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.ai-footer {
  bottom: -18px;
}
.ai-image-grid article > strong {
  font-size: 12px;
}
.dialog:has(.design-ai) > .dialog-content > .design-ai {
  overflow: auto;
  min-height: 0;
  padding-bottom: 0;
}
.design-ai .ai-footer {
  bottom: 0;
  margin-bottom: 0;
  padding-bottom: 16px;
}
</style>
