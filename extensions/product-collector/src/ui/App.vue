<script setup lang="ts">
import type { ImportResult, Product } from '../core/types'
import Modal from '@t-box/ui-kit/Modal.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { version } from '../../package.json'
import { emptySession, exportProducts } from '../core/session'
import { getSession, request, subscribe } from './api'
import AccountMenu from './components/AccountMenu.vue'
import Icon from './components/Icon.vue'
import ProductDetail from './components/ProductDetail.vue'

const sourceTab = Number(new URLSearchParams(location.search).get('sourceTab')) || undefined
const state = ref(emptySession())
const pageNo = ref(1)
const pageSize = ref(50)
const keyword = ref('')
const search = ref('')
const result = ref<ImportResult | null>(null)
const selected = ref<string[]>([])
const detail = ref<Product | null>(null)
const busy = ref(false)
const stopRequested = ref(false)
const error = ref('')
const notice = ref('')
const deleteOpen = ref(false)
const visible = computed(() => state.value.products.filter((p) => `${p.title} ${p.sourceId} ${p.platformName}`.toLowerCase().includes(search.value.toLowerCase())))
const allChecked = computed(() => !!visible.value.length && visible.value.every((p) => selected.value.includes(p.id)))
watch([keyword, pageSize], () => {
  pageNo.value = 1
  result.value = null
})
async function refresh() {
  state.value = await getSession()
  selected.value = selected.value.filter((id) => state.value.products.some((p) => p.id === id))
  if (detail.value) {
    detail.value = state.value.products.find((p) => p.id === detail.value?.id) || null
  }
}
let unsubscribe = () => {}
onMounted(async () => {
  unsubscribe = subscribe(() => {
    void refresh().catch((e) => {
      error.value = String(e)
    })
  })
  try {
    await refresh()
  } catch (e) {
    error.value = String(e)
  }
})
onBeforeUnmount(() => {
  stopRequested.value = true
  unsubscribe()
})
async function read(start: number, continuous = false) {
  if (busy.value) {
    return
  }
  busy.value = true
  stopRequested.value = false
  error.value = ''
  notice.value = ''
  let added = 0
  let updated = 0
  let skipped = 0
  const warnings: string[] = []
  try {
    let next = start
    do {
      pageNo.value = next
      notice.value = `正在读取第 ${next} 页…`
      const response = await request<ImportResult>('import-page', { tabId: sourceTab, pageNo: next, pageSize: pageSize.value, searchValue: keyword.value })
      result.value = response
      added += response.added
      updated += response.updated
      skipped += response.skipped
      warnings.push(...response.warnings)
      await refresh()
      next++
      if (!continuous || response.pageNo >= response.totalPage || response.received === 0 || stopRequested.value) {
        break
      }
    } while (true)
    notice.value = `${stopRequested.value ? '已停止继续翻页。' : ''}新增 ${added} 件，更新 ${updated} 件，跳过 ${skipped} 条。${warnings.slice(0, 3).join('；')}`
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败，请重试'
    notice.value = `本次已保存：新增 ${added} 件，更新 ${updated} 件；已导入的资料保留。`
  } finally {
    busy.value = false
  }
}
function toggleAll() {
  selected.value = allChecked.value ? selected.value.filter((id) => !visible.value.some((p) => p.id === id)) : [...new Set([...selected.value, ...visible.value.map((p) => p.id)])]
}
function download(products: Product[]) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([exportProducts(products)], { type: 'application/json' }))
  link.href = url
  link.download = `tark-products-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function remove() {
  try {
    await request('remove', { ids: selected.value })
    deleteOpen.value = false
    await refresh()
  } catch (e) {
    error.value = String(e)
  }
}
</script>

<template>
  <main class="inbox">
    <header class="inbox-header">
      <div>
        <strong>
          店小秘采集列表
        </strong><span class="version">
          v{{ version }}
        </span>
      </div>
      <span class="muted">
        临时预览 · 关闭浏览器后清除 · 尚未上传方舟
      </span>
      <AccountMenu />
    </header>
    <section class="import-panel" aria-label="读取店小秘列表">
      <div class="toolbar">
        <label class="search">
          <Icon name="search" /><input
            v-model="keyword"
            :disabled="busy"
            placeholder="按店小秘商品名称搜索"
            aria-label="店小秘商品名称"
            @keyup.enter="read(1)"
          >
        </label>
        <div class="segmented" aria-label="每页数量">
          <button
            v-for="size in [20, 50, 100]"
            :key="size"
            :disabled="busy"
            :aria-pressed="pageSize === size"
            :class="{ active: pageSize === size }"
            @click="pageSize = size"
          >
            {{ size }} 条
          </button>
        </div>
        <button
          class="primary"
          :disabled="busy"
          @click="read(pageNo)"
        >
          <Icon name="download" />读取此页
        </button>
        <button :disabled="busy" @click="read(pageNo, true)">
          从此页连续导入
        </button>
        <button
          v-if="busy"
          :disabled="stopRequested"
          @click="stopRequested = true"
        >
          {{ stopRequested ? '本页完成后停止' : '停止翻页' }}
        </button>
      </div>
      <div class="pagination">
        <button :disabled="busy || pageNo <= 1" @click="read(pageNo - 1)">
          读取上一页
        </button>
        <label>
          第 <input
            v-model.number="pageNo"
            type="number"
            min="1"
            :disabled="busy"
            aria-label="读取页码"
          > 页
        </label>
        <span v-if="result" class="muted">
          共 {{ result.totalPage }} 页 / {{ result.totalSize }} 条
        </span>
        <button :disabled="busy || !result || result.pageNo >= result.totalPage" @click="read(result!.pageNo + 1)">
          读取下一页
        </button>
        <span class="muted">
          重复商品更新已有记录；每页成功后保存，失败可重试。
        </span>
      </div>
    </section>
    <p
      v-if="notice"
      class="feedback"
      role="status"
    >
      {{ notice }}
    </p>
    <p
      v-if="error"
      class="feedback error"
      role="alert"
    >
      {{ error }}
    </p>
    <section aria-label="临时商品预览">
      <div class="toolbar preview-toolbar">
        <strong>
          预览 {{ state.products.length }} / 200 件
        </strong>
        <label class="search">
          <Icon name="search" /><input
            v-model="search"
            placeholder="筛选已导入商品"
            aria-label="筛选预览"
          >
        </label>
        <button :disabled="!state.products.length" @click="download(selected.length ? state.products.filter((p) => selected.includes(p.id)) : state.products)">
          <Icon name="download" />{{ selected.length ? `导出所选 ${selected.length} 件` : '导出全部' }}
        </button>
        <button
          class="danger"
          :disabled="!selected.length || busy"
          @click="deleteOpen = true"
        >
          移除所选
        </button>
      </div>
      <div v-if="visible.length" class="imported-list">
        <label class="select-all">
          <input
            type="checkbox"
            :checked="allChecked"
            @change="toggleAll"
          >全选当前结果
        </label>
        <article
          v-for="product in visible"
          :key="product.id"
          class="imported-row"
        >
          <input
            v-model="selected"
            type="checkbox"
            :value="product.id"
            :aria-label="`选择 ${product.title}`"
          >
          <button class="product-cell" @click="detail = product">
            <span class="product-thumb">
              <img
                v-if="product.assets.find((a) => a.role === 'main')"
                :src="product.assets.find((a) => a.role === 'main')?.url"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              ><Icon v-else name="image" />
            </span>
            <span>
              <strong>
                {{ product.title || '未命名商品' }}
              </strong><small>
                {{ product.platformName }} · {{ product.sourceId }}
              </small>
            </span>
          </button>
          <div class="row-price">
            <strong>
              {{ product.price.amount === null ? '价格未获取' : `${product.price.currency || '币种待核对'} ${product.price.amount}` }}
            </strong><small>
              {{ product.variants.length }} 条规格 · {{ product.assets.length }} 项媒体
            </small>
          </div>
          <span class="badge" :class="product.status">
            {{ product.missing.length ? `缺 ${product.missing.length} 项资料` : '待核对' }}
          </span>
          <button @click="detail = product">
            预览
          </button>
        </article>
      </div>
      <div v-else class="empty-state">
        <Icon name="box" /><strong>
          {{ state.products.length ? '没有匹配的商品' : '还没有导入商品' }}
        </strong><p>
          登录店小秘后点击“读取此页”，在这里预览商品、图片和规格。
        </p>
      </div>
    </section>
    <ProductDetail
      :product="detail"
      @close="detail = null"
      @export="download([$event])"
    />
    <Modal
      :open="deleteOpen"
      title="移除临时预览"
      @close="deleteOpen = false"
    >
      <p>
        移除所选 {{ selected.length }} 件商品？只清理插件临时资料，不修改店小秘数据。
      </p>
      <template #footer>
        <button @click="deleteOpen = false">
          取消
        </button><button class="danger" @click="remove">
          确认移除
        </button>
      </template>
    </Modal>
  </main>
</template>
