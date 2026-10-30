<script setup lang="ts">
import { Modal } from '@t-box/ui-kit'
import { ref, watch } from 'vue'
import { identity } from '../../core/session'
import { accountChanged, copyPromotionLink, loadPromotionShare, promotionAssetUrl, promotionShare } from './share'

const imageError = ref(false)
const imageLoaded = ref(false)
const attempt = ref(0)
watch(() => identity.user?.id, accountChanged, { immediate: true })
watch(() => promotionShare.info?.posterPath, () => {
  imageError.value = false
  imageLoaded.value = false
})
function retryImage() {
  imageError.value = false
  imageLoaded.value = false
  attempt.value++
}
</script>

<template>
  <Modal
    :open="promotionShare.open"
    title="分享 T方舟"
    class="promotion-share-dialog"
    @close="promotionShare.open = false"
  >
    <div class="promotion-share-layout">
      <p class="promotion-share-intro">二维码已关联你的账号。朋友扫码首次注册后，将记录为你的推广成果。</p>
      <div class="promotion-share-preview">
        <div
          v-if="promotionShare.loading && !promotionShare.info"
          class="promotion-share-status"
          role="status"
        >正在生成你的专属海报…</div>
        <div
          v-if="imageError && promotionShare.info"
          class="promotion-share-error"
          role="alert"
        >
          <p>海报加载失败，请检查网络后重试。</p><button class="button" @click="retryImage">重新加载海报</button>
        </div>
        <div
          v-else-if="promotionShare.info"
          class="promotion-image-frame"
          :aria-busy="!imageLoaded"
        >
          <span
            v-if="!imageLoaded"
            class="promotion-share-status"
            role="status"
          >正在加载海报…</span>
          <img
            :key="attempt"
            :src="promotionAssetUrl(promotionShare.info.posterPath, { attempt: String(attempt) })"
            alt="带个人专属二维码的 T方舟分享海报"
            width="1080"
            height="1920"
            @load="imageLoaded = true"
            @error="imageError = true"
          >
        </div>
      </div>
      <div class="promotion-share-details">
        <div
          v-if="promotionShare.error"
          class="promotion-share-error"
          role="alert"
        >
          <p>{{ promotionShare.error }}</p><button class="button" @click="loadPromotionShare">重新加载</button>
        </div>
        <template v-if="promotionShare.info">
          <p class="promotion-share-tip">长按海报保存或发送给朋友，微信内也可通过右上角菜单分享。</p>
          <p
            v-if="promotionShare.sdkNotice"
            class="promotion-share-tip"
            role="status"
          >{{ promotionShare.sdkNotice }}</p>
          <p
            v-if="promotionShare.notice"
            class="promotion-share-notice"
            role="status"
          >{{ promotionShare.notice }}</p>
          <label class="promotion-link-label">你的推广链接<input
            :value="promotionShare.info.shareUrl"
            readonly
            aria-label="个人推广链接"
            @focus="($event.target as HTMLInputElement).select()"
          ></label>
        </template>
      </div>
    </div>
    <template v-if="promotionShare.info" #footer>
      <button
        class="button"
        @click="copyPromotionLink"
      >复制链接</button>
      <a
        v-if="imageLoaded"
        class="button button-primary"
        :href="promotionAssetUrl(promotionShare.info.posterPath, { download: '1' })"
        download="t-ark-poster.png"
      >下载海报</a>
    </template>
  </Modal>
</template>

<style scoped>
.promotion-share-dialog {
  width: min(720px, calc(100% - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
  max-width: none;
  height: min(680px, calc(100dvh - 48px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
  max-height: calc(100dvh - 48px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  overscroll-behavior: contain;
}
.promotion-share-dialog :deep(.dialog-content) {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  min-height: 0;
}
.promotion-share-dialog :deep(.dialog-heading),
.promotion-share-dialog :deep(.dialog-footer) {
  flex: none;
  margin: 0;
}
.promotion-share-dialog :deep(.dialog-footer) {
  flex-wrap: nowrap;
}
.promotion-share-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas: 'preview intro' 'preview details';
  gap: 16px 24px;
}
.promotion-share-intro {
  grid-area: intro;
  color: #647781;
  font-size: 12px;
  line-height: 1.8;
  margin: 0;
}
.promotion-share-preview {
  grid-area: preview;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
}
.promotion-share-details {
  grid-area: details;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.promotion-image-frame {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 10px;
  overflow: hidden;
}
.promotion-image-frame img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.promotion-image-frame .promotion-share-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #f9fbfa;
}
.promotion-share-status {
  padding: 20px 0;
  color: #647781;
  font-size: 13px;
  text-align: center;
}
.promotion-share-tip {
  color: #647781;
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
}
.promotion-share-notice {
  color: #137b72;
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
}
.promotion-share-error {
  padding: 16px;
  background: #fff3ee;
  border-radius: 10px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.promotion-share-error p {
  margin: 0 0 12px;
}
.promotion-share-preview > .promotion-share-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
}
.promotion-share-preview > .promotion-share-error p {
  margin: 0;
}
.promotion-share-error .button {
  flex-shrink: 0;
}
.promotion-link-label {
  display: grid;
  gap: 8px;
  color: #647781;
  font-size: 12px;
}
.promotion-link-label input {
  width: 100%;
  min-width: 0;
  padding: 10px;
  border: 1px solid #dce5e1;
  border-radius: 8px;
  font-size: 12px;
  background: #f9fbfa;
  color: #24483d;
}
.button {
  min-height: 44px;
  text-decoration: none;
}
@media (max-width: 600px) {
  .promotion-share-dialog {
    width: calc(100% - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
    height: min(840px, calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
    max-height: calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  }
  .promotion-share-dialog :deep(.dialog-content) {
    padding: 16px;
    gap: 12px;
  }
  .promotion-share-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas: 'intro' 'preview' 'details';
    gap: 12px;
  }
  .promotion-share-intro {
    line-height: 1.6;
  }
  .promotion-share-details {
    gap: 8px;
  }
  .promotion-link-label {
    gap: 4px;
  }
  .promotion-link-label input {
    padding: 8px 10px;
    font-size: 16px;
    line-height: 20px;
  }
  .promotion-share-dialog :deep(.dialog-footer) .button {
    flex: 1;
    min-width: 0;
  }
}
@media (max-height: 500px) and (min-width: 601px) {
  .promotion-share-dialog {
    height: calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
    max-height: calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  }
  .promotion-share-dialog :deep(.dialog-content) {
    padding: 16px;
    gap: 10px;
  }
  .promotion-share-layout,
  .promotion-share-details {
    gap: 8px 16px;
  }
  .promotion-share-intro,
  .promotion-share-tip,
  .promotion-share-notice {
    line-height: 1.5;
  }
}
</style>
