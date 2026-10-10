<script setup lang="ts">
import type { CustomerSupportConfiguration } from '@t-box/shared'
import { AppIcon, Modal } from '@t-box/ui-kit'
import { onBeforeUnmount, ref, watch } from 'vue'
import { request } from '../../core/network'
import { isNativeIos } from '../../core/platform'

const props = defineProps<{ active: boolean }>()
const ios = isNativeIos()
const configuration = ref<CustomerSupportConfiguration>({
  enabled: false,
  qrCodeUrl: '',
})
const open = ref(false)
const loading = ref(false)
const error = ref('')
const imageLoaded = ref(false)
const imageFailed = ref(false)
const imageVersion = ref(0)
let controller: AbortController | undefined

async function load() {
  if (!ios) {
    return
  }
  controller?.abort()
  const current = (controller = new AbortController())
  loading.value = true
  error.value = ''
  try {
    const result = await request<{ data: CustomerSupportConfiguration }>(
      '/support',
      { signal: current.signal },
    )
    if (current.signal.aborted) {
      return
    }
    configuration.value = result.data
    imageLoaded.value = false
    imageFailed.value = false
    imageVersion.value++
  } catch (cause) {
    if (!current.signal.aborted) {
      error.value =
        cause instanceof Error ? cause.message : '暂时无法读取客服信息'
    }
  } finally {
    if (controller === current) {
      loading.value = false
    }
  }
}
function contact() {
  open.value = true
  void load()
}
watch(
  () => props.active,
  (active) => {
    if (active) {
      void load()
    } else {
      open.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <button
    v-if="ios && configuration.enabled && configuration.qrCodeUrl"
    type="button"
    class="support-entry"
    aria-label="联系客服"
    @click="contact"
  >
    <AppIcon name="support" :size="17" /><span>联系客服</span>
  </button>
  <Modal
    :open="ios && open"
    title="联系客服"
    @close="open = false"
  >
    <div class="support-contact">
      <div class="support-contact-heading">
        <span class="support-contact-icon"><AppIcon
          name="support"
          :size="22"
        /></span>
        <h3>微信客服</h3>
        <p>使用咨询与问题反馈</p>
      </div>
      <p
        v-if="loading"
        class="support-message"
        role="status"
      >
        正在读取客服信息…
      </p>
      <div
        v-else-if="error"
        class="support-message"
        role="alert"
      >
        <p>{{ error }}</p>
        <button type="button" @click="load">重新加载</button>
      </div>
      <template v-else-if="configuration.enabled && configuration.qrCodeUrl">
        <div class="support-qr-frame">
          <img
            v-show="!imageFailed"
            :key="imageVersion"
            :src="configuration.qrCodeUrl"
            alt="微信客服二维码"
            width="224"
            height="224"
            referrerpolicy="no-referrer"
            @load="imageLoaded = true"
            @error="imageFailed = true"
          >
          <p
            v-if="!imageLoaded && !imageFailed"
            class="support-message"
            role="status"
          >
            二维码加载中…
          </p>
          <div
            v-if="imageFailed"
            class="support-message"
            role="alert"
          >
            <p>二维码暂时无法加载</p>
            <button type="button" @click="load">重新加载</button>
          </div>
        </div>
        <p v-if="imageLoaded && !imageFailed" class="support-qr-caption">
          保存二维码或截图后，在微信中识别
        </p>
      </template>
      <p
        v-else
        class="support-message"
        role="status"
      >客服暂未开放</p>
    </div>
  </Modal>
</template>

<style scoped>
.support-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 9px;
  padding: 8px 9px;
  background: transparent;
  color: #526760;
  font-size: 12px;
  white-space: nowrap;
}
.support-entry:active {
  background: #e8efec;
}
.support-entry:focus-visible {
  outline: 2px solid #54736d;
  outline-offset: 3px;
}
.support-contact {
  text-align: center;
  padding: 5px 0 14px;
}
.support-contact-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  border-radius: 14px;
  background: #eef4f1;
  color: #54736d;
}
.support-contact-heading h3 {
  font-size: 17px;
  font-weight: 550;
  margin: 0 0 6px;
}
.support-contact-heading p,
.support-qr-caption {
  font-size: 12px;
  line-height: 1.7;
  color: #858b91;
}
.support-contact-heading p {
  margin: 0 0 22px;
}
.support-qr-frame {
  width: min(248px, 100%);
  margin: 0 auto;
  padding: 12px;
  border: 1px solid #e5ebe7;
  border-radius: 16px;
  background: #fff;
}
.support-qr-frame img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  object-fit: contain;
}
.support-qr-caption {
  margin: 16px 0 0;
}
.support-message {
  padding: 16px 8px;
  font-size: 13px;
  line-height: 1.7;
  color: #707d77;
}
.support-message p {
  margin: 0 0 10px;
}
.support-message button {
  background: #f2f6f4;
  color: #526760;
  border: 1px solid #dfe7e2;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12px;
}
</style>
