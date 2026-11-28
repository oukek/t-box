<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ urls: string[] }>()
const urls = computed(() => [...new Set(props.urls)])
const failed = ref<string[]>([])
watch(() => props.urls, () => {
  failed.value = []
})
</script>

<template>
  <section
    v-if="urls.length"
    class="product-videos"
    aria-label="商品视频"
  >
    <h4>商品视频</h4>
    <figure v-for="(url, index) in urls" :key="url">
      <video
        :src="url"
        controls
        playsinline
        preload="none"
        :aria-label="`商品视频 ${index + 1}`"
        @error="failed.push(url)"
      >浏览器不支持视频播放。</video>
      <figcaption>
        <span v-if="failed.includes(url)" role="status">暂时无法播放，原链接可能失效、限制访问或格式不受支持。</span>
        <a
          :href="url"
          target="_blank"
          rel="noopener noreferrer"
        >打开视频原链接</a>
      </figcaption>
    </figure>
  </section>
</template>

<style scoped>
.product-videos {
  margin-block: 20px;
}
.product-videos h4 {
  margin: 0 0 12px;
}
.product-videos figure {
  margin: 0 0 18px;
}
.product-videos video {
  display: block;
  width: 100%;
  max-width: 790px;
  max-height: 60dvh;
  aspect-ratio: 16 / 9;
  background: #15242d;
  border-radius: 8px;
}
.product-videos figcaption {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  font-size: 12px;
}
</style>
