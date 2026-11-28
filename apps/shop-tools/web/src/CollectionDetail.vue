<script setup lang="ts">
import type { CollectedProduct as Product, SourceSku as Variant } from '@t-box/shop-tools-contracts'
import FormControl from '@t-box/ui-kit/FormControl.vue'
import Modal from '@t-box/ui-kit/Modal.vue'
import { computed, ref, watch } from 'vue'
import ProductVideos from './ProductVideos.vue'

const props = defineProps<{ product: Product | null }>()
defineEmits<{ close: [] }>()
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
const supplemental = computed(() => props.product?.assets.filter((a) => ['size-chart', 'instruction'].includes(a.role)) || [])
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
}, { immediate: true })
</script>

<template>
  <Modal
    :open="!!product"
    title="商品预览"
    class="collection-product-dialog collection-storefront-dialog"
    @close="$emit('close')"
  >
    <div
      v-if="product"
      ref="scroller"
      class="collection-storefront-scroll"
    >
      <section class="collection-storefront-hero" aria-label="商品信息">
        <div class="collection-storefront-gallery">
          <a
            v-if="imageUrl"
            class="collection-storefront-main-image"
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
              查看原图
            </span>
          </a>
          <div v-else class="collection-storefront-main-image empty-line">
            暂无商品图片
          </div>
          <div
            v-if="gallery.length"
            class="collection-storefront-thumbnails"
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
          <div class="collection-storefront-gallery-note">
            <span>
              {{ gallery.length }} 张商品图
            </span><a
              v-if="product.sourceUrl"
              :href="product.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看原商品
            </a>
          </div>
        </div>
        <div class="collection-storefront-info">
          <div class="collection-storefront-source">
            <span class="platform-label">
              {{ product.platformName }}
            </span><span>
              商品编号 {{ product.sourceId || '未获取' }}
            </span>
          </div>
          <h3 class="collection-storefront-title">
            {{ product.title || '标题未获取' }}
          </h3>
          <div class="collection-storefront-price-panel">
            <span>
              {{ chosen ? '所选规格价格' : '商品来源价格' }}
            </span>
            <strong class="collection-storefront-price">
              {{ price }}
            </strong>
            <div class="collection-storefront-price-meta"><span>{{ product.variants.length }} 种规格</span></div>
          </div>
          <div v-if="product.variants.length" class="collection-storefront-options">
            <div class="collection-storefront-option-heading">
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
            <FormControl
              v-if="product.variants.length > 8"
              v-model="variantSearch"
              class="collection-storefront-variant-search"
              placeholder="搜索规格名称或编号"
              aria-label="搜索规格"
              @input="expanded = true"
            />
            <div class="collection-storefront-variant-list">
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
                </span>
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
            <p v-if="chosen" class="collection-storefront-selected">
              已选：{{ variantLabel(chosen) }}<span class="mono">
                {{ chosen.id || chosen.sku }}
              </span>
            </p>
          </div>
          <p v-else class="muted">
            接口未返回规格信息
          </p>
        </div>
      </section>
      <nav class="collection-storefront-navigation" aria-label="商品内容导航">
        <button @click="jump(parameters)">
          商品参数
        </button><button @click="jump(description)">
          图文详情
        </button><button @click="jump(specifications)">
          规格明细
        </button>
      </nav>
      <section ref="parameters" class="collection-storefront-section">
        <h4>
          商品参数
        </h4>
        <dl class="collection-storefront-parameters">
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
        <p v-if="!product.attributes.length && !product.packaging.length" class="muted">
          接口未返回商品参数
        </p>
      </section>
      <section ref="description" class="collection-storefront-section">
        <h4>
          图文详情
        </h4>
        <p v-if="product.description" class="collection-storefront-description">
          {{ product.description }}
        </p>
        <div v-if="detailImages.length" class="collection-storefront-detail-images">
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
        <ProductVideos :urls="product.assets.filter(a => a.role === 'video').map(a => a.url)" />
        <div v-if="supplemental.length" class="collection-storefront-supplemental">
          <a
            v-for="(asset, index) in supplemental"
            :key="index"
            :href="asset.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ asset.role === 'video' ? '商品视频' : asset.role === 'size-chart' ? '尺码表' : '说明文件' }}
          </a>
        </div>
      </section>
      <section ref="specifications" class="collection-storefront-section">
        <h4>
          规格明细
        </h4>
        <details v-if="product.variants.length" class="collection-storefront-all-variants">
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
    </div>
    <template #footer><span class="footer-note">已采集的原商品资料</span><button @click="$emit('close')">关闭</button></template>
  </Modal>
</template>

<style src="./collection-detail.css"></style>
