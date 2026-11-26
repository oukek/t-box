<script setup lang="ts">
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { ref } from 'vue'
import { installed, installPrompt } from './installPrompt'
import MacDownloads from './MacDownloads.vue'

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const mac = !ios && /Mac/.test(navigator.platform)
const wechat = /MicroMessenger/i.test(navigator.userAgent)
const mobile = ios || /Android/.test(navigator.userAgent)
const installLabel = mobile ? '添加到主屏幕' : '添加到电脑'
const safariOnMac = mac && /Version.*Safari/.test(navigator.userAgent)
const chromeOnMac = mac && /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\//.test(navigator.userAgent)
const help = ref(false)
async function install() {
  const deferred = installPrompt.value
  installPrompt.value = undefined
  if (!deferred) {
    help.value = true
    return
  }
  try {
    await deferred.prompt()
    if ((await deferred.userChoice).outcome === 'accepted') {
      installed.value = true
    }
  } catch {
    help.value = true
  }
}
</script>

<template>
  <button
    v-if="!installed"
    class="desktop-action install-entry"
    @click="help = true"
  >
    <AppIcon name="apps" :size="16" />安装方舟
  </button>
  <BottomSheet
    compact
    desktop-modal
    :open="help"
    title="安装方舟"
    @close="help = false"
  >
    <section class="install-help">
      <h3>{{ installLabel }}</h3>
      <button
        v-if="installPrompt"
        class="button button-primary"
        @click="install"
      >{{ installLabel }}</button>
      <p v-else-if="wechat">从右上角菜单选择在系统浏览器打开，再添加方舟。</p>
      <p v-else-if="ios">用 Safari 打开方舟，轻点「分享」→「添加到主屏幕」。</p>
      <p v-else-if="chromeOnMac">在 Chrome 菜单选择「投放、保存和分享」→「将网页安装为应用」。</p>
      <p v-else-if="safariOnMac">在 Safari 的「文件」菜单中选择「添加到程序坞」。</p>
      <p v-else-if="mobile">在浏览器菜单中选择「安装应用」或「添加到主屏幕」。</p>
      <p v-else>可在 Chrome 或 Edge 的地址栏或菜单中选择安装此网站。</p>
      <MacDownloads v-if="help" show-status />
    </section>
  </BottomSheet>
</template>

<style scoped>
.install-entry {
  border-radius: 20px;
  padding-inline: 11px;
  white-space: nowrap;
}
.install-help h3 {
  font-size: 15px;
  margin: 4px 0;
}
.install-help p {
  color: var(--muted);
  margin: 4px 0 16px;
}
</style>
