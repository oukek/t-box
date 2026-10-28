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
    <p class="promotion-share-intro">二维码已关联你的账号。朋友扫码首次注册后，将记录为你的推广成果。</p>
    <div
      v-if="promotionShare.loading && !promotionShare.info"
      class="promotion-share-status"
      role="status"
    >正在生成你的专属海报…</div>
    <div
      v-if="promotionShare.error"
      class="promotion-share-error"
      role="alert"
    >
      <p>{{ promotionShare.error }}</p><button class="button" @click="loadPromotionShare">重新加载</button>
    </div>
    <template v-if="promotionShare.info">
      <div
        v-if="imageError"
        class="promotion-share-error"
        role="alert"
      >
        <p>海报加载失败，请检查网络后重试。</p><button class="button" @click="retryImage">重新加载海报</button>
      </div>
      <div
        v-else
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
      <p class="promotion-share-tip">长按海报保存或发送给朋友。微信内也可通过右上角菜单分享。</p>
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
    <template #footer>
      <button
        v-if="promotionShare.info"
        class="button"
        @click="copyPromotionLink"
      >复制链接</button>
      <a
        v-if="promotionShare.info && imageLoaded"
        class="button button-primary"
        :href="promotionAssetUrl(promotionShare.info.posterPath, { download: '1' })"
        download="t-ark-poster.png"
      >下载海报</a>
    </template>
  </Modal>
</template>

<style scoped>
.promotion-share-intro {
  color: #647781;
  font-size: 12px;
  line-height: 1.8;
  margin: 0 0 16px;
}
.promotion-image-frame {
  position: relative;
  width: min(100%, 340px);
  margin: auto;
  border-radius: 10px;
  overflow: hidden;
  background: #082b26;
}
.promotion-image-frame img {
  display: block;
  width: 100%;
  height: auto;
}
.promotion-image-frame .promotion-share-status {
  position: absolute;
  inset: 45% 0 auto;
  color: #f7fbf9;
  text-align: center;
}
.promotion-share-status {
  padding: 20px 0;
  color: #647781;
  font-size: 13px;
}
.promotion-share-tip {
  color: #647781;
  font-size: 12px;
  line-height: 1.7;
}
.promotion-share-notice {
  color: #137b72;
  font-size: 12px;
}
.promotion-share-error {
  padding: 16px;
  background: #fff3ee;
  border-radius: 10px;
  font-size: 13px;
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
  text-decoration: none;
}
</style>
