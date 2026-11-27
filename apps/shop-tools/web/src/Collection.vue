<script setup lang="ts">
import type { AppClient } from '@t-box/app-sdk'
import type { CollectionItem } from '@t-box/shop-tools-contracts'
import { Modal } from '@t-box/ui-kit'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import { onMounted, ref } from 'vue'

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
    <div
      v-for="item in items"
      :key="item.id"
      class="site-row"
    >
      <FormControl
        v-if="projectId"
        type="checkbox"
        :checked="selected.includes(item.id)"
        :disabled="busy || claimed.includes(item.id) || (selected.length >= 20 && !selected.includes(item.id))"
        :aria-label="'认领 ' + item.data.title"
        @change="toggle(item.id, ($event.target as HTMLInputElement).checked)"
      />
      <div class="catalog-item"><strong>{{ item.data.title }}</strong><small>{{ item.data.platformName }} · {{ item.data.variants.length }} 个 SKU · {{ item.data.price.currency || '币种待确认' }} {{ item.data.price.amount || '价格待确认' }}</small><small v-if="claimed.includes(item.id)">本项目已认领</small></div>
      <button @click="detail = item">查看原商品</button>
    </div>
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
    <Modal
      :open="!!detail"
      title="原商品资料"
      @close="detail = undefined"
    >
      <div v-if="detail" class="shop-dialog-body">
        <h3>{{ detail.data.title }}</h3><p style="white-space: pre-wrap">{{ detail.data.description }}</p>
        <a
          v-if="detail.data.sourceUrl"
          :href="detail.data.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
        >查看来源</a>
        <div class="catalog-images"><img
          v-for="asset in detail.data.assets.filter(a => a.role === 'main' || a.role === 'detail').slice(0, 30)"
          :key="asset.url"
          :src="asset.url"
          loading="lazy"
          alt="来源商品图片"
        ></div>
        <div
          v-for="sku in detail.data.variants"
          :key="sku.id"
          class="site-row"
        ><span>{{ sku.attributes.map(a => a.name + ': ' + a.value).join(' / ') || sku.sku || sku.id }}</span><span>{{ sku.currency }} {{ sku.price }}</span></div>
      </div>
    </Modal>
  </section>
</template>
