<script setup lang="ts">
import { AppIcon, Modal } from '@t-box/ui-kit'
import { ref } from 'vue'
import { installed, installPrompt } from './installPrompt'

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const mac = !ios && /Mac/.test(navigator.platform)
const installLabel = mac ? '添加到 Dock' : '添加到桌面'
const mobile = ios || /Android/.test(navigator.userAgent)
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
    v-if="!installed && (mac || mobile || installPrompt)"
    class="desktop-action"
    :aria-label="installLabel"
    :title="installLabel"
    @click="install"
  >
    <AppIcon name="apps" :size="19" />
  </button>
  <Modal
    :open="help"
    :title="installLabel"
    @close="help = false"
  >
    <template v-if="chromeOnMac">
      <p>点 Chrome 地址栏右侧的安装图标，或打开右上角「⋮」→「投放、保存和分享」→「将网页安装为应用」。</p>
      <p>安装后独立打开放舟，右键点击 Dock 中的方舟图标，选择「选项」→「在程序坞中保留」。</p>
    </template>
    <p v-else-if="ios">用 Safari 打开方舟，轻点「分享」，选择「添加到主屏幕」，再轻点「添加」。</p>
    <p v-else-if="mac">在 macOS Sonoma 14 或更高版本，用 Safari 打开方舟，选择菜单栏「文件」→「添加到程序坞」，再点「添加」。</p>
    <p v-else>用 Chrome 打开方舟，在浏览器菜单中选择「安装应用」或「添加到主屏幕」。</p>
    <template #footer><button class="button button-primary" @click="help = false">知道了</button></template>
  </Modal>
</template>
