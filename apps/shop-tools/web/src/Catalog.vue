<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { CatalogDetail, CatalogProduct, CatalogVersion, PricingSnapshot, ProjectSummary } from '@t-box/shop-tools-contracts'
import { projectSites } from '@t-box/shop-tools-contracts'
import { catalogMedia, clone } from '@t-box/shop-tools-core'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CatalogImage from './CatalogImage.vue'
import Collection from './Collection.vue'
import EditDialog from './EditDialog.vue'
import ProductOptimization from './ProductOptimization.vue'
import ProductVideos from './ProductVideos.vue'
import SkuPricing from './SkuPricing.vue'

const props = defineProps<{ client: AppClient, project: ProjectSummary, showCreative: boolean }>()
const newId = () => crypto.randomUUID()
const items = ref<CatalogProduct[]>([])
const offset = ref<number | null>(0)
const error = ref('')
const busy = ref(false)
const claiming = ref(false)
const detail = ref<CatalogDetail>()
const draft = ref<CatalogVersion>()
const ai = ref(false)
const optimizer = ref<InstanceType<typeof ProductOptimization>>()
async function closeAI() {
  try {
    await optimizer.value?.flush()
    ai.value = false
  } catch {}
}
const pricing = ref<number | null>(null)
const skuSearch = ref('')
const skuPage = ref(0)
const previewUrl = ref('')
const readonly = computed(() => props.project.role === 'viewer')
const currency = computed(() => projectSites.find((s) => s.value === props.project.site)?.currency || '')
const filtered = computed(() => draft.value?.content.skus.map((sku, index) => ({ sku, index })).filter((x) => `${x.sku.name} ${x.sku.code}`.toLowerCase().includes(skuSearch.value.toLowerCase())) || [])
const visible = computed(() => filtered.value.slice(skuPage.value * 20, (skuPage.value + 1) * 20))
function call<T>(action: string, args: Record<string, unknown> = {}, key?: string) {
  return props.client.api.invoke<T>('catalog', { action, projectId: props.project.id, ...args }, key ? { idempotencyKey: key } : undefined)
}
async function run(job: () => Promise<void>) {
  if (busy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    await job()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function load(reset = false) {
  const start = reset ? 0 : offset.value
  if (start === null) {
    return
  }
  const page = await call<{ items: CatalogProduct[], nextOffset: number | null }>('list', { offset: start })
  items.value = reset ? page.items : [...items.value, ...page.items]
  offset.value = page.nextOffset
}
async function open(id: string, versionId?: string) {
  detail.value = await call<CatalogDetail>('get', { id })
  draft.value = clone(detail.value.versions.find((v) => v.id === versionId) || detail.value.versions.at(-1)!)
  skuPage.value = 0
  skuSearch.value = ''
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = ''
}
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== JSON.stringify(detail.value?.versions.find((v) => v.id === draft.value?.id)))
async function save() {
  const d = draft.value!
  await call('save', { id: detail.value!.product.id, versionId: d.id, revision: d.revision, name: d.name, content: d.content })
  await open(detail.value!.product.id, d.id)
  await load(true)
}
let versionKey: string | undefined
async function version() {
  if (dirty.value) {
    error.value = '请先保存当前商品修改，再创建版本'
    return
  }
  versionKey ||= crypto.randomUUID()
  const { id } = await call<{ id: string }>('version', { id: detail.value!.product.id, versionId: draft.value!.id, revision: draft.value!.revision }, versionKey)
  versionKey = undefined
  ai.value = false
  await open(detail.value!.product.id, id)
  await load(true)
}
function removeImage(id: string) {
  const content = draft.value!.content
  const media = catalogMedia(content).filter((a) => a.id !== id)
  content.media = media
  delete content.imageFileId
  content.images = media.filter((a) => !a.skuId).map((a) => a.url)
}
function resetPrice(index: number) {
  const sku = draft.value!.content.skus[index]!
  sku.price = null
  sku.pricing = null
}
function priced(snapshot: PricingSnapshot) {
  const sku = draft.value!.content.skus[pricing.value!]!
  sku.cost = Number(snapshot.row.cost)
  sku.price = snapshot.result.price
  sku.currency = snapshot.route.currency
  sku.pricing = snapshot
  pricing.value = null
}
function close() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = ''
  draft.value = undefined
  detail.value = undefined
  error.value = ''
}
onBeforeUnmount(() => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
})
onMounted(() => run(() => load(true)))
</script>

<template>
  <main class="shop-content">
    <div class="toolbar"><span>{{ projectSites.find(s => s.value === project.site)?.label || '请先设置项目国家站点' }}</span><button
      class="primary"
      :disabled="readonly || !project.site || busy"
      @click="claiming = true"
    >从采集表认领商品</button></div>
    <p
      v-if="error"
      class="notice error"
      role="alert"
    >{{ error }}</p>
    <section class="panel project-list">
      <div
        v-for="item in items"
        :key="item.id"
        class="site-row"
      ><div class="catalog-item"><strong>{{ item.title }}</strong><small>{{ item.modified ? '已修改' : '未修改' }}</small></div><button :disabled="busy" @click="run(() => open(item.id))">{{ readonly ? '查看商品' : '编辑商品' }}</button></div>
      <p v-if="!items.length && !busy">当前项目没有商品，请从个人采集表认领。</p>
      <button
        v-if="offset !== null"
        :disabled="busy"
        @click="run(() => load())"
      >{{ busy ? '读取中…' : '加载更多' }}</button>
    </section>
    <Modal
      :open="claiming"
      title="从个人采集表认领"
      class="shop-dialog shop-dialog-long"
      @close="claiming = false"
    ><Collection
      v-if="claiming"
      :client="client"
      :project-id="project.id"
      @claimed="run(() => load(true))"
    /></Modal>
    <EditDialog
      :open="!!draft"
      title="项目商品"
      long
      :busy="busy"
      :readonly="readonly"
      @close="close"
      @save="run(save)"
    >
      <template v-if="draft && detail">
        <p v-if="error" role="alert">{{ error }}</p>
        <SheetSelect
          :model-value="draft.id"
          label="商品版本"
          desktop-modal
          :disabled="busy"
          :options="detail.versions.map(v => ({ value: v.id, label: v.name }))"
          @update:model-value="dirty ? error = '请先保存修改或关闭后重新打开' : run(() => open(detail!.product.id, String($event)))"
        />
        <div v-if="!readonly" class="toolbar"><button :disabled="busy || dirty" @click="run(() => version())">复制为新版本</button><button
          v-if="showCreative"
          :disabled="busy || dirty"
          @click="ai = true"
        >AI 优化为新版本</button></div>
        <div class="fields two-columns"><label class="field">版本名称<FormControl
          v-model="draft.name"
          :readonly="readonly"
          maxlength="80"
        /></label><label class="field">商品标题<FormControl
          v-model="draft.content.title"
          :readonly="readonly"
          maxlength="1000"
        /></label></div>
        <label class="field">商品描述<FormControl
          v-model="draft.content.description"
          multiline
          rows="5"
          :readonly="readonly"
        /></label>
        <div class="catalog-images"><figure v-for="asset in catalogMedia(draft.content).filter(a => !a.skuId)" :key="asset.id"><CatalogImage
          :client="client"
          :project-id="project.id"
          :product-id="detail.product.id"
          :asset="asset"
          alt="商品图片"
        /><button v-if="!readonly" @click="removeImage(asset.id)">移除图片</button></figure></div>
        <ProductVideos :urls="draft.content.videos || []" />
        <div class="toolbar"><label class="field">筛选 SKU<FormControl
          v-model="skuSearch"
          placeholder="规格 / 编码"
          @input="skuPage = 0"
        /></label><span>{{ filtered.length }} 个 SKU</span><button
          v-if="!readonly"
          :disabled="draft.content.skus.length >= 1000"
          @click="draft.content.skus.push({ id: newId(), code: '', name: '自定义规格', sourceSkuId: null, images: [], cost: null, price: null, currency, pricing: null }); skuSearch = ''; skuPage = Math.floor((draft.content.skus.length - 1) / 20)"
        >添加 SKU</button></div>
        <div class="catalog-table"><table><thead><tr><th>SKU 图片</th><th>规格 / 自有编码</th><th>成本 CNY</th><th>折前售价 {{ currency }}</th><th>操作</th></tr></thead><tbody><tr v-for="{ sku, index } in visible" :key="sku.id"><td><div v-if="sku.images?.length" class="catalog-sku-images"><CatalogImage
          v-for="asset in catalogMedia(draft.content).filter(a => a.skuId === sku.id)"
          :key="asset.id"
          :client="client"
          :project-id="project.id"
          :product-id="detail.product.id"
          :asset="asset"
          :alt="sku.name"
        /></div><small v-else>暂无规格图</small></td><td><FormControl
          v-model="sku.name"
          :readonly="readonly"
          aria-label="SKU 规格"
        /><FormControl
          v-model="sku.code"
          :readonly="readonly"
          aria-label="自有 SKU 编码"
        /><small>来源：{{ sku.sourceSkuId || '自定义' }}</small></td><td><FormControl
          v-model.number="sku.cost"
          type="number"
          min="0"
          step="0.01"
          :readonly="readonly"
          aria-label="采购成本人民币"
          @input="resetPrice(index)"
        /><small v-if="sku.cost === null">需确认人民币成本</small></td><td>{{ sku.price === null ? '待定价' : sku.price }}<small v-if="sku.pricing">已保存计价参数</small></td><td><button :disabled="readonly || busy" @click="pricing = index">{{ sku.pricing ? '改价' : '算价' }}</button><button :disabled="readonly || busy" @click="draft.content.media = draft.content.media?.filter(a => a.skuId !== sku.id); draft.content.skus.splice(index, 1); skuPage = Math.min(skuPage, Math.max(0, Math.ceil(filtered.length / 20) - 1))">移除</button></td></tr></tbody></table></div>
        <div class="toolbar"><button :disabled="skuPage === 0" @click="skuPage--">上一页</button><span>{{ skuPage + 1 }} / {{ Math.max(1, Math.ceil(filtered.length / 20)) }}</span><button :disabled="(skuPage + 1) * 20 >= filtered.length" @click="skuPage++">下一页</button></div>
      </template>
    </EditDialog>
    <SkuPricing
      v-if="pricing !== null && draft"
      :client="client"
      :project-id="project.id"
      :site="project.site!"
      :sku="draft.content.skus[pricing]!"
      @close="pricing = null"
      @confirm="priced"
    />
    <Modal
      :open="ai"
      title="AI 优化 · 创建商品新版本"
      class="shop-dialog shop-dialog-long"
      @close="closeAI"
    ><ProductOptimization
      v-if="ai && draft && detail"
      ref="optimizer"
      :client="client"
      :project="project"
      :version="draft"
      :product-id="detail.product.id"
      @apply="run(async() => { ai = false;await open(detail!.product.id, $event.id);await load(true) })"
    /></Modal>
  </main>
</template>

<style scoped>
.catalog-sku-images {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  width: 140px;
  max-height: 148px;
  overflow: auto;
}
.catalog-sku-images a {
  display: block;
  width: 60px;
  height: 60px;
}
.catalog-sku-images img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: 1px solid #dfe7ec;
  border-radius: 6px;
  background: #f8fafb;
}
</style>
