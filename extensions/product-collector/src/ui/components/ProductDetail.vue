<script setup lang="ts">
import type { Product, Variant } from '../../core/types'
import Modal from '@t-box/ui-kit/Modal.vue'
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{ product: Product | null }>()
defineEmits<{ close: [], export: [product: Product] }>()
const imageUrl = ref('')
const chosen = ref<Variant | null>(null)
const expanded = ref(false)
const variantSearch = ref('')
const scroller = ref<HTMLElement | null>(null)
const parameters = ref<HTMLElement | null>(null)
const description = ref<HTMLElement | null>(null)
const specifications = ref<HTMLElement | null>(null)
const unique = (urls: string[]) => [...new Set(urls)]
const detailImages = computed(() => unique(props.product?.assets.filter((a) => a.role === 'detail').map((a) => a.url) || []))
const gallery = computed(() => {
  const main = props.product?.assets.filter((a) => a.role === 'main').map((a) => a.url) || []
  const images = main.filter((url) => !detailImages.value.includes(url))
  const base = images.length ? images : main.length ? main : props.product?.assets.filter((a) => a.role === 'variant').map((a) => a.url) || []
  return unique([...(chosen.value?.images || []), ...base])
})
const variants = computed(() => props.product?.variants.filter((v) => `${v.id} ${v.sku} ${variantLabel(v)}`.toLowerCase().includes(variantSearch.value.toLowerCase())) || [])
const shownVariants = computed(() => expanded.value ? variants.value : variants.value.slice(0, 8))
const price = computed(() => {
  const amount = chosen.value ? chosen.value.price : props.product?.price.amount
  const currency = chosen.value ? chosen.value.currency : props.product?.price.currency
  return amount == null ? '价格未获取' : `${currency || '币种待核对'} ${amount}`
})
const stock = computed(() => chosen.value ? chosen.value.stock : props.product?.stock)
const supplemental = computed(() => props.product?.assets.filter((a) => ['size-chart', 'instruction', 'video'].includes(a.role)) || [])
function variantLabel(variant: Variant) {
  return variant.attributes.map((a) => a.value).join(' / ') || variant.sku || variant.id || '未命名规格'
}
function choose(variant: Variant) {
  chosen.value = chosen.value === variant ? null : variant
  imageUrl.value = gallery.value[0] || ''
}
function jump(target: HTMLElement | null) {
  if (!target || !scroller.value) {
    return
  }
  scroller.value.scrollTop += target.getBoundingClientRect().top - scroller.value.getBoundingClientRect().top - 52
}
watch(() => props.product, () => {
  chosen.value = null
  expanded.value = false
  variantSearch.value = ''
  imageUrl.value = gallery.value[0] || ''
  if (scroller.value) {
    scroller.value.scrollTop = 0
  }
})
</script>

<template>
  <Modal
    :open="!!product"
    title="商品预览"
    class="product-dialog storefront-dialog"
    @close="$emit('close')"
  >
    <div
      v-if="product"
      ref="scroller"
      class="storefront-scroll"
    >
      <section class="storefront-hero" aria-label="商品信息">
        <div class="storefront-gallery">
          <a
            v-if="imageUrl"
            class="storefront-main-image"
            :href="imageUrl"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="打开当前原图"
          >
            <img
              :src="imageUrl"
              :alt="product.title || '商品主图'"
              referrerpolicy="no-referrer"
            >
            <span>
              查看原图 <Icon name="external" />
            </span>
          </a>
          <div v-else class="storefront-main-image empty-line">
            <Icon name="image" />暂无商品图片
          </div>
          <div
            v-if="gallery.length"
            class="storefront-thumbnails"
            aria-label="商品图库"
          >
            <button
              v-for="(url, index) in gallery"
              :key="url"
              :class="{ active: imageUrl === url }"
              :aria-label="`查看商品图 ${index + 1}`"
              :aria-pressed="imageUrl === url"
              @click="imageUrl = url"
            >
              <img
                :src="url"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              >
            </button>
          </div>
          <div class="storefront-gallery-note">
            <span>
              {{ gallery.length }} 张商品图
            </span><a
              v-if="product.sourceUrl"
              :href="product.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看原商品 <Icon name="external" />
            </a>
          </div>
        </div>
        <div class="storefront-info">
          <div class="storefront-source">
            <span class="platform-label">
              {{ product.platformName }}
            </span><span>
              商品编号 {{ product.sourceId || '未获取' }}
            </span>
          </div>
          <h3 class="storefront-title">
            {{ product.title || '标题未获取' }}
          </h3>
          <div class="storefront-price-panel">
            <span>
              {{ chosen ? '所选规格价格' : '商品来源价格' }}
            </span>
            <strong class="storefront-price">
              {{ price }}
            </strong>
            <small v-if="!chosen && product.price.discount">
              折扣价 {{ product.price.currency }} {{ product.price.discount }}
            </small>
            <small v-if="!chosen && product.price.original">
              原价 {{ product.price.currency }} {{ product.price.original }}
            </small>
            <small v-if="!chosen && product.price.maximum">
              最高价 {{ product.price.currency }} {{ product.price.maximum }}
            </small>
            <div class="storefront-price-meta">
              <span>
                库存 {{ stock ?? '未获取' }}
              </span><span>
                {{ product.variants.length }} 种规格
              </span>
            </div>
          </div>
          <div v-if="product.variants.length" class="storefront-options">
            <div class="storefront-option-heading">
              <strong>
                选择规格
              </strong><button
                v-if="chosen"
                class="text-button"
                @click="chosen = null; imageUrl = gallery[0] || ''"
              >
                清除选择
              </button>
            </div>
            <input
              v-if="product.variants.length > 8"
              v-model="variantSearch"
              class="storefront-variant-search"
              placeholder="搜索规格名称或编号"
              aria-label="搜索规格"
              @input="expanded = true"
            >
            <div class="storefront-variant-list">
              <button
                v-for="(variant, index) in shownVariants"
                :key="index"
                :class="{ active: chosen === variant }"
                :aria-pressed="chosen === variant"
                :title="variant.attributes.map((a) => `${a.name}：${a.value}`).join(' / ')"
                @click="choose(variant)"
              >
                <img
                  v-if="variant.images[0]"
                  :src="variant.images[0]"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                ><span>
                  {{ variantLabel(variant) }}
                </span><small v-if="variant.stock === 0">
                  无库存
                </small>
              </button>
            </div>
            <p v-if="!variants.length" class="muted">
              没有匹配的规格
            </p>
            <button
              v-if="variants.length > 8"
              class="text-button"
              :aria-expanded="expanded"
              @click="expanded = !expanded"
            >
              {{ expanded ? '收起规格' : `展开全部 ${variants.length} 种规格` }}
            </button>
            <p v-if="chosen" class="storefront-selected">
              已选：{{ variantLabel(chosen) }}<span class="mono">
                {{ chosen.id || chosen.sku }}
              </span>
            </p>
          </div>
          <p v-else class="muted">
            接口未返回规格信息
          </p>
          <div class="storefront-summary">
            <span v-if="product.brand">
              品牌：{{ product.brand }}
            </span><span v-if="product.seller.name">
              店铺：{{ product.seller.name }}
            </span><span v-if="product.sold !== null">
              销量：{{ product.sold }}
            </span><span v-if="product.sku || product.spu">
              SKU / SPU：{{ product.sku || '—' }} / {{ product.spu || '—' }}
            </span>
          </div>
          <div v-if="product.tags.length" class="chips">
            <span v-for="tag in product.tags" :key="tag">
              {{ tag }}
            </span>
          </div>
        </div>
      </section>
      <nav class="storefront-navigation" aria-label="商品内容导航">
        <button @click="jump(parameters)">
          商品参数
        </button><button @click="jump(description)">
          图文详情
        </button><button @click="jump(specifications)">
          规格明细
        </button>
      </nav>
      <section ref="parameters" class="storefront-section">
        <h4>
          商品参数
        </h4>
        <dl class="storefront-parameters">
          <div v-if="product.category.path.length || product.category.id">
            <dt>
              类目
            </dt><dd>
              {{ product.category.path.join(' / ') || product.category.id }}
            </dd>
          </div>
          <div v-for="(attr, index) in product.attributes" :key="`attr-${index}`">
            <dt>
              {{ attr.name }}
            </dt><dd>
              {{ attr.value }}
            </dd>
          </div>
          <div v-for="(attr, index) in product.packaging" :key="`package-${index}`">
            <dt>
              {{ attr.name }}
            </dt><dd>
              {{ attr.value }}
            </dd>
          </div>
        </dl>
        <p v-if="!product.attributes.length && !product.packaging.length && !product.category.id && !product.category.path.length" class="muted">
          接口未返回商品参数
        </p>
      </section>
      <section ref="description" class="storefront-section">
        <h4>
          图文详情
        </h4>
        <p v-if="product.description" class="storefront-description">
          {{ product.description }}
        </p>
        <div v-if="detailImages.length" class="storefront-detail-images">
          <img
            v-for="(url, index) in detailImages"
            :key="url"
            :src="url"
            :alt="`商品详情图 ${index + 1}`"
            loading="lazy"
            referrerpolicy="no-referrer"
          >
        </div>
        <p v-if="!product.description && !detailImages.length" class="empty-line">
          接口未返回图文详情
        </p>
        <div v-if="supplemental.length" class="storefront-supplemental">
          <a
            v-for="(asset, index) in supplemental"
            :key="index"
            :href="asset.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ asset.role === 'video' ? '商品视频' : asset.role === 'size-chart' ? '尺码表' : '说明文件' }} <Icon name="external" />
          </a>
        </div>
      </section>
      <section ref="specifications" class="storefront-section">
        <h4>
          规格明细
        </h4>
        <div v-if="product.price.tiers.length" class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  起订数量
                </th><th>
                  数量上限
                </th><th>
                  单价
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="(tier, index) in product.price.tiers" :key="index">
                <td>
                  {{ tier.minimum }}
                </td><td>
                  {{ tier.maximum ?? '未获取' }}
                </td><td>
                  {{ product.price.currency }} {{ tier.amount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <details v-if="product.variants.length" class="storefront-all-variants">
          <summary>
            查看全部 {{ product.variants.length }} 条规格与价格
          </summary><div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    规格
                  </th><th>
                    编号 / SKU
                  </th><th>
                    价格
                  </th><th>
                    库存
                  </th><th>
                    图片
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="(variant, index) in product.variants" :key="index">
                  <td>
                    {{ variantLabel(variant) }}
                  </td><td class="mono">
                    {{ variant.id }}<small>
                      {{ variant.sku }}
                    </small>
                  </td><td>
                    {{ variant.price === null ? '未获取' : `${variant.currency || '币种待核对'} ${variant.price}` }}
                  </td><td>
                    {{ variant.stock ?? '未获取' }}
                  </td><td>
                    <img
                      v-if="variant.images[0]"
                      class="sku-image"
                      :src="variant.images[0]"
                      alt="规格图"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <p v-else class="muted">
          接口未返回规格明细
        </p>
      </section>
      <details class="storefront-audit checks">
        <summary>
          采集检查 · {{ product.evidence.length }} / 8 项资料已获取
        </summary>
        <div v-if="product.missing.length" class="chips warning">
          <span v-for="field in product.missing" :key="field">
            待补：{{ field }}
          </span>
        </div>
        <p class="muted">
          字段覆盖情况不代表资料已核验。
        </p>
        <ul class="notices">
          <li v-for="warning in product.warnings" :key="warning">
            {{ warning }}
          </li>
        </ul>
        <dl>
          <template v-for="entry in product.evidence" :key="entry.field">
            <dt>
              {{ entry.field }}
            </dt><dd>
              {{ entry.source }}
            </dd>
          </template>
        </dl>
        <details>
          <summary>
            查看商品结构化数据
          </summary><pre>{{ JSON.stringify(product.sourceData, null, 2) }}</pre>
        </details>
      </details>
    </div>
    <template #footer>
      <span class="footer-note">
        原始资料预览 · 尚未上传到方舟
      </span><button @click="$emit('close')">
        关闭
      </button><button
        class="primary"
        :disabled="!product"
        @click="product && $emit('export', product)"
      >
        <Icon name="download" />导出此商品
      </button>
    </template>
  </Modal>
</template>

<style src="./product-detail.css"></style>
