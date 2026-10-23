<script setup lang="ts">
import { AppIcon, Modal } from '@t-box/ui-kit'
import { computed } from 'vue'
import { downloadAudience, downloadTargets } from './download-targets'
import { nativeDownload, refreshHostDownloads } from './downloads'

const audience = downloadAudience(navigator)
const targets = computed(() => downloadTargets(nativeDownload.settings, nativeDownload.availability === 'ios' ? 'ios' : audience))
const downloadDescription = computed(() => {
  const name = nativeDownload.settings.displayName
  if (nativeDownload.availability === 'ios' && audience !== 'ios') {
    return `此功能目前仅在 iPhone / iPad App 中提供，请从 App Store 下载“${name}”。`
  }
  return audience === 'ios' ? `请从 App Store 下载“${name}”，安装后使用。` : `请下载“${name}”App，安装后使用。`
})
</script>

<template>
  <Modal
    :open="nativeDownload.open"
    title="在 App 中使用"
    @close="nativeDownload.open = false"
  >
    <div class="download-intro">
      <span class="download-mark"><AppIcon name="apps" :size="24" /></span>
      <div><strong>{{ nativeDownload.feature }}</strong><p>此功能需要调用系统能力，网页版暂不支持。</p></div>
    </div>
    <p class="download-description">{{ downloadDescription }}</p>
    <div class="download-targets">
      <div
        v-for="target in targets"
        :key="target.platform"
        class="download-target"
      >
        <div><strong>{{ target.label }}</strong><span>{{ target.description }}</span></div>
        <a
          v-if="target.url"
          class="button"
          :href="target.url"
          target="_blank"
          rel="noopener noreferrer"
        >{{ target.platform === 'ios' ? '前往 App Store' : '前往下载' }}<AppIcon name="right" :size="15" /></a>
        <span
          v-else
          class="download-unavailable"
          role="status"
        >{{ nativeDownload.loading ? '获取地址中…' : '下载地址暂未开放' }}</span>
      </div>
    </div>
    <p
      v-if="nativeDownload.error"
      class="download-error"
      role="status"
    >{{ nativeDownload.error }}<button
      class="download-retry"
      :disabled="nativeDownload.loading"
      @click="refreshHostDownloads"
    >重试</button></p>
    <template #footer><button class="button button-secondary" @click="nativeDownload.open = false">继续使用网页版</button></template>
  </Modal>
</template>

<style scoped>
.download-intro {
  display: flex;
  gap: 12px;
  align-items: center;
}
.download-mark {
  display: grid;
  place-items: center;
  flex: 0 0 46px;
  height: 46px;
  border-radius: 14px;
  background: #edf4f1;
  color: #527b6a;
}
.download-intro strong {
  font-size: 15px;
  font-weight: 600;
}
.download-intro p,
.download-description {
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted, #708276);
}
.download-intro p {
  margin: 4px 0 0;
}
.download-description {
  margin: 18px 0 12px;
}
.download-targets {
  border: 1px solid #e2e9e4;
  border-radius: 12px;
  overflow: hidden;
}
.download-target {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
}
.download-target + .download-target {
  border-top: 1px solid #e2e9e4;
}
.download-target strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
.download-target span {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--muted, #708276);
}
.download-target .button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 9px 12px;
  white-space: nowrap;
  font-size: 12px;
  text-decoration: none;
}
.download-target .download-unavailable {
  font-size: 12px;
  margin: 0;
  text-align: right;
}
.download-error {
  font-size: 12px;
  color: var(--muted, #708276);
  line-height: 1.7;
}
.download-retry {
  border: 0;
  background: transparent;
  color: #477361;
  padding: 4px 8px;
  font: inherit;
  cursor: pointer;
}
@media (max-width: 360px) {
  .download-target {
    flex-wrap: wrap;
  }
}
</style>
