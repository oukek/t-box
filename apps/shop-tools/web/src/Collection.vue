<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { CollectionItem } from '@t-box/shop-tools-contracts'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { computed, onMounted, ref } from 'vue'
import CollectionDetail from './CollectionDetail.vue'

import CollectorDownload from './CollectorDownload.vue'

const props = defineProps<{ client: AppClient, projectId?: string }>()
const emit = defineEmits<{ claimed: [] }>()
const collectorDownload = ref(false)
const items = ref<CollectionItem[]>([])
const claimed = ref<string[]>([])
const selected = ref<string[]>([])
const offset = ref<number | null>(0)
const busy = ref(false)
const error = ref('')
const detail = ref<CollectionItem>()
const search = ref('')
const visible = computed(() => items.value.filter((item) => `${item.data.title} ${item.data.sourceId} ${item.data.platformName}`.toLowerCase().includes(search.value.trim().toLowerCase())))
function thumbnail(item: CollectionItem) {
  return item.data.assets.find((a) => a.role === 'main')?.url || item.data.variants.flatMap((s) => s.images)[0] || ''
}
async function load() {
  if (offset.value === null) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    const page = await props.client.api.invoke<{ items: CollectionItem[], nextOffset: number | null }>('catalog', { action: 'collection', offset: offset.value })
    if (props.projectId) {
      claimed.value.push(...await props.client.api.invoke<string[]>('catalog', { action: 'claimed', projectId: props.projectId, ids: page.items.map((x) => x.id) }))
    }
    items.value.push(...page.items)
    offset.value = page.nextOffset
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function claim() {
  busy.value = true
  error.value = ''
  try {
    await props.client.api.invoke('catalog', { action: 'claim', projectId: props.projectId, ids: selected.value })
    claimed.value.push(...selected.value)
    selected.value = []
    emit('claimed')
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
function toggle(id: string, checked: unknown) {
  selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter((x) => x !== id)
}
onMounted(load)
</script>

<template>
  <section class="panel catalog-list">
    <header v-if="!projectId" class="collection-heading"><h2>采集商品</h2><button @click="collectorDownload = true">下载采集插件</button></header>
    <CollectorDownload v-if="collectorDownload" @close="collectorDownload = false" />
    <p v-if="error" role="alert">{{ error }}</p>
    <p class="muted">{{ projectId ? '选择个人采集表中的商品；当前项目已认领的商品不可重复选择。' : '插件确认采集后的个人商品，不随项目切换。来源图片以原链接展示。' }}</p>
    <div class="toolbar collection-toolbar"><strong>已加载 {{ items.length }} 件</strong><FormControl
      v-model="search"
      placeholder="筛选已加载商品"
      aria-label="筛选已加载商品"
    /></div>
    <div
      v-for="item in visible"
      :key="item.id"
      class="collection-product-row"
    >
      <FormControl
        v-if="projectId"
        type="checkbox"
        :checked="selected.includes(item.id)"
        :disabled="busy || claimed.includes(item.id) || (selected.length >= 20 && !selected.includes(item.id))"
        :aria-label="'认领 ' + item.data.title"
        @change="toggle(item.id, ($event.target as HTMLInputElement).checked)"
      />
      <button class="collection-product-cell" @click="detail = item">
        <span class="collection-product-thumb"><img
          v-if="thumbnail(item)"
          :src="thumbnail(item)"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
        ><span v-else>暂无图片</span></span>
        <span><strong>{{ item.data.title }}</strong><small>{{ item.data.platformName }} · {{ item.data.sourceId || '编号未获取' }}</small></span>
      </button>
      <div class="collection-row-price"><strong>{{ item.data.price.amount === null ? '价格未获取' : `${item.data.price.currency || '币种待核对'} ${item.data.price.amount}` }}</strong><small>{{ item.data.variants.length }} 条规格 · {{ item.data.assets.length }} 项媒体</small></div>
      <span v-if="claimed.includes(item.id)" class="collection-claimed">本项目已认领</span>
      <button @click="detail = item">查看详情</button>
    </div>
    <p v-if="items.length && !visible.length">没有匹配的商品，试试其他关键词。</p>
    <p v-if="!busy && !items.length">还没有商品，请在插件中选择商品并点击“确认采集”。</p>
    <div class="toolbar"><button
      v-if="offset !== null"
      :disabled="busy"
      @click="load"
    >{{ error ? '重试读取' : busy ? '正在读取…' : '加载更多' }}</button><button
      v-if="projectId"
      class="primary"
      :disabled="busy || !selected.length"
      @click="claim"
    >确认认领 {{ selected.length }} 件</button></div>
    <CollectionDetail :product="detail?.data || null" @close="detail = undefined" />
  </section>
</template>

<style scoped>
.collection-toolbar {
  justify-content: space-between;
  margin-block: 16px;
}
.collection-toolbar :deep(input) {
  max-width: 280px;
}
.collection-product-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 0;
  border-bottom: 1px solid #edf1f4;
}
.collection-product-cell {
  display: flex;
  flex: 1;
  min-width: 0;
  justify-content: flex-start;
  text-align: left;
  border: 0;
  background: none;
  padding: 0;
  gap: 16px;
}
.collection-product-thumb {
  width: 70px;
  height: 76px;
  border-radius: 8px;
  overflow: hidden;
  background: #f2f5f7;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: #718391;
  font-size: 11px;
}
.collection-product-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.collection-product-cell > span:last-child {
  min-width: 0;
}
.collection-product-cell strong {
  font-size: 13px;
  font-weight: 550;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.collection-product-cell small,
.collection-row-price small {
  display: block;
  color: var(--muted);
  margin-top: 8px;
}
.collection-row-price {
  min-width: 125px;
}
.collection-row-price strong {
  font:
    500 14px 'SFMono-Regular',
    monospace;
}
.collection-claimed {
  font-size: 11px;
  padding: 4px 7px;
  background: #edf6f2;
  color: #19735b;
  border-radius: 5px;
}
@media (max-width: 600px) {
  .collection-product-row {
    flex-wrap: wrap;
    gap: 12px;
  }
  .collection-product-cell {
    flex-basis: calc(100% - 48px);
  }
  .collection-row-price {
    flex: 1;
  }
  .collection-toolbar :deep(input) {
    max-width: 100%;
  }
}
</style>
