<script setup lang="ts">
import { Modal } from '@t-box/ui-kit'
import { onMounted, ref } from 'vue'

defineEmits<{ close: [] }>()
const download = ref<{ version: string, url: string, file: string }>()
const error = ref('')
onMounted(async () => {
  try {
    const response = await fetch(new URL('downloads/collector.json', document.baseURI), { credentials: 'omit' })
    if (!response.ok) {
      throw new Error('此构建尚未提供插件安装包，请使用已发布的电商助手版本')
    }
    const data = await response.json()
    if (!/^\d+\.\d+\.\d+$/.test(data.version) || data.file !== `tark-collector-${data.version}.zip`) {
      throw new Error('插件下载信息无效，请更新电商助手后重试')
    }
    download.value = { version: data.version, file: data.file, url: new URL(`downloads/${data.file}`, document.baseURI).href }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取下载信息失败'
  }
})
</script>

<template>
  <Modal
    open
    title="采集插件下载与安装"
    @close="$emit('close')"
  >
    <p>用于桌面 Chrome 120 或更高版本。安装后可从店小秘确认采集到个人采集表。</p>
    <p
      v-if="error"
      class="notice error"
      role="alert"
    >{{ error }}</p>
    <p v-else-if="!download">正在读取安装包…</p>
    <p v-else><a :href="download.url" :download="download.file">下载插件 ZIP · v{{ download.version }}</a></p>
    <ol>
      <li>解压 ZIP，放在固定文件夹，安装后请勿删除或移动。</li>
      <li>在 Chrome 地址栏输入 <code>chrome://extensions</code>，开启“开发者模式”。</li>
      <li>点击“加载已解压的扩展程序”，选择包含 <code>manifest.json</code> 的文件夹。</li>
      <li>刷新店小秘页面，打开插件并登录。</li>
    </ol>
    <p>更新时将新版文件覆盖到原文件夹，在扩展管理页面点击插件的重新加载按钮，再刷新店小秘。此方式不会自动更新。</p>
    <p class="muted">ZIP 不能直接导入 Chrome；自行打包为 CRX 也不能绕过普通 Mac、Windows Chrome 的安装限制。</p>
    <template #footer><button @click="$emit('close')">知道了</button></template>
  </Modal>
</template>
