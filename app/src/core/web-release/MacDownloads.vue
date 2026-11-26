<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiBase } from '../network'

defineProps<{ showStatus?: boolean }>()
const loaded = ref(false)
const chips = [{ id: 'aarch64', label: 'Apple 芯片' }, { id: 'x86_64', label: 'Intel' }]
const availableChips = ref<string[]>([])
const recommendedChip = ref('')
onMounted(async () => {
  try {
    const res = await fetch(apiBase + '/system-updates/macos/installers', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      availableChips.value = (await res.json()).architectures ?? []
    }
    const hints = (navigator as Navigator & { userAgentData?: { platform: string, getHighEntropyValues: (keys: string[]) => Promise<{ architecture?: string }> } }).userAgentData
    if (hints?.platform === 'macOS') {
      const { architecture } = await hints.getHighEntropyValues(['architecture'])
      recommendedChip.value = architecture === 'arm' ? 'aarch64' : architecture === 'x86' ? 'x86_64' : ''
    }
  } catch { /* Keep device selection manual if hints are unavailable. */ } finally {
    loaded.value = true
  }
})
</script>

<template>
  <div v-if="availableChips.length" class="mac-download">
    <strong>下载 Mac 版</strong>
    <a
      v-for="chip in chips.filter(item => availableChips.includes(item.id))"
      :key="chip.id"
      :href="apiBase + '/system-updates/macos/' + chip.id + '/installer'"
    >
      {{ chip.label }}{{ recommendedChip === chip.id ? '（推荐）' : '' }}
    </a>
  </div>
  <p v-else-if="showStatus" role="status">{{ loaded ? '暂未取得 Mac 安装包，请稍后再试。' : '正在查询 Mac 安装包…' }}</p>
</template>

<style scoped>
.mac-download {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-block: 16px;
}
.mac-download a {
  padding: 6px 12px;
  border: 1px solid #d6dce6;
  border-radius: 8px;
  color: inherit;
}
</style>
