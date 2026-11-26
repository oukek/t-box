<script setup lang="ts">
import { applicationNames } from 'virtual:tbox-local-applications'
import { computed, onMounted } from 'vue'
import { nativeDownload, refreshHostDownloads } from './downloads'

const props = defineProps<{ appId: string }>()
const name = computed(() => Object.hasOwn(applicationNames, props.appId) ? applicationNames[props.appId] : props.appId)
const params = new URLSearchParams(location.search)
if (location.pathname === '/open.html') {
  params.delete('app')
}
const suffix = params.size ? '?' + params.toString() : ''
onMounted(refreshHostDownloads)
</script>

<template>
  <main class="application-link">
    <img
      src="/favicon.svg"
      width="56"
      height="56"
      alt="T方舟"
    >
    <h1>{{ appId ? name : '链接无效' }}</h1>
    <template v-if="appId">
      <a class="button" :href="'tbox://link/' + appId + suffix">在方舟中打开</a>
      <a v-if="nativeDownload.settings.iosAppStoreUrl" :href="nativeDownload.settings.iosAppStoreUrl">下载 iOS 版方舟</a>
      <span v-else-if="!nativeDownload.loading">iOS 下载地址暂未提供</span>
      <a :href="'/#/applications/' + appId + suffix">使用网页版</a>
    </template>
  </main>
</template>

<style scoped>
.application-link {
  min-height: 100dvh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
}
.application-link h1 {
  margin: 0 0 8px;
  font-size: 22px;
}
.application-link span {
  font-size: 13px;
}
</style>
