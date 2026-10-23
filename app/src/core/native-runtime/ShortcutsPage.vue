<script setup lang="ts">
import type { NativeShortcutTemplate } from '@t-box/capacitor-device-runtime'
import { Modal } from '@t-box/ui-kit'
import ApplicationHeader from '@t-box/ui-kit/ApplicationHeader.vue'
import { onMounted, ref } from 'vue'
import { backFromApplication } from '../navigation'
import { nativeDevice } from './adapter'

const templates = ref<NativeShortcutTemplate[]>([])
const supported = ref(false)
const error = ref('')
const removal = ref<NativeShortcutTemplate | null>(null)
const busy = ref(false)
async function load() {
  try {
    const plugin = await nativeDevice()
    supported.value = true
    templates.value = (await plugin.templates()).templates
  } catch {
    supported.value = false
  }
}
async function remove() {
  if (!removal.value || busy.value) {
    return
  }
  busy.value = true
  try {
    await (await nativeDevice()).removeTemplate({ id: removal.value.id })
    removal.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除失败'
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="shortcuts-page">
    <ApplicationHeader
      title="快捷指令"
      back-label="设置"
      @back="backFromApplication"
    />
    <p v-if="!supported" class="muted">请在 iOS App 中配置系统快捷指令；此页面不会影响网页本地工具的使用。</p>
    <template v-else>
      <article class="shortcut-guide"><h2>从系统调用 T方舟</h2><ol><li>打开 iPhone 的“快捷指令”，添加一个操作。</li><li>搜索 T方舟，选择“打开 T方舟 应用”或“执行 T方舟 快捷动作”。</li><li>选择已安装的应用，或下方已保存的动作。</li></ol><p>本地应用可离线打开。云端动作需要联网和有效登录；应用更新或权限变化后，可能需要重新保存动作。</p></article>
      <h2>已保存的动作</h2>
      <p v-if="!templates.length" class="muted">可在计算器的历史记录或单位换算结果中保存快捷动作。</p>
      <article
        v-for="item in templates"
        :key="item.id"
        class="shortcut-row"
      ><div><strong>{{ item.title }}</strong><small>{{ item.appId }} · {{ item.actionId }}</small></div><button class="button button-secondary" @click="removal = item">删除</button></article>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
    <Modal
      :open="!!removal"
      title="删除快捷动作"
      :busy="busy"
      @close="removal = null"
    ><p>删除“{{ removal?.title }}”？引用此动作的系统快捷指令将无法继续执行。</p><div class="dialog-actions"><button
      class="button button-secondary"
      :disabled="busy"
      @click="removal = null"
    >取消</button><button
      class="button button-danger"
      :disabled="busy"
      @click="remove"
    >删除</button></div></Modal>
  </section>
</template>

<style scoped>
.shortcuts-page {
  max-width: 760px;
  margin: auto;
  padding: 16px;
}
.shortcuts-page h2 {
  font-size: 15px;
}
.shortcuts-page p,
.shortcuts-page li {
  font-size: 13px;
  line-height: 1.8;
}
.shortcut-guide {
  padding: 16px;
  border: 1px solid var(--border, #e3e7eb);
  border-radius: 16px;
  margin: 12px 0 24px;
}
.shortcut-guide ol {
  padding-left: 20px;
}
.shortcut-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border, #e3e7eb);
}
.shortcut-row strong {
  font-size: 14px;
}
.shortcut-row small {
  display: block;
  margin-top: 4px;
  color: var(--muted, #7c858e);
  font-size: 12px;
}
</style>
