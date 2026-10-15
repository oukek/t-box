<script setup lang="ts">
import { SidePanel } from '@t-box/ui-kit'
import { ref, watch } from 'vue'
import { request } from '../../core/network'
import { identity } from '../../core/session'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], tasks: [] }>()
interface Inbox { unread: number, items: { id: string, taskId: string, title: string, read: boolean, createdAt: string }[] }
const inbox = ref<Inbox>({ unread: 0, items: [] })
const busy = ref(false)
const error = ref('')
let revision = 0
watch(() => [props.open, identity.user?.id] as const, async ([open, user]) => {
  const started = ++revision
  inbox.value = { unread: 0, items: [] }
  error.value = ''
  if (!open || !user) {
    return
  }
  busy.value = true
  try {
    const result = await request<{ data: Inbox }>('/notifications')
    if (started === revision) {
      inbox.value = result.data
    }
  } catch (cause) {
    if (started === revision) {
      error.value = cause instanceof Error ? cause.message : '通知暂时不可用'
    }
  } finally {
    if (started === revision) {
      busy.value = false
    }
  }
}, { immediate: true })
async function read(id?: string) {
  if (busy.value) {
    return
  }
  const started = revision
  busy.value = true
  error.value = ''
  try {
    await request(id ? `/notifications/${id}/read` : '/notifications/read', { method: 'PATCH' })
    if (started !== revision) {
      return
    }
    for (const item of inbox.value.items) {
      if (!id || item.id === id) {
        item.read = true
      }
    }
    inbox.value.unread = inbox.value.items.filter((item) => !item.read).length
    if (id) {
      emit('tasks')
    }
  } catch (cause) {
    if (started === revision) {
      error.value = cause instanceof Error ? cause.message : '通知更新失败'
    }
  } finally {
    if (started === revision) {
      busy.value = false
    }
  }
}
</script>

<template>
  <SidePanel
    :open="open"
    title="通知"
    @close="emit('close')"
  >
    <div class="notification-toolbar"><span>{{ inbox.unread ? `${inbox.unread} 条未读` : '暂无未读通知' }}</span><button
      :disabled="busy || !inbox.unread"
      class="text-button"
      @click="read()"
    >全部已读</button></div>
    <p
      v-if="error"
      class="form-error"
      role="alert"
    >{{ error }}</p>
    <p v-if="busy && !inbox.items.length" class="notification-empty">正在读取…</p>
    <p v-else-if="!inbox.items.length" class="notification-empty">任务完成或需要处理时，会在这里通知你。</p>
    <ul class="notification-list"><li v-for="item in inbox.items" :key="item.id"><button
      :class="{ unread: !item.read }"
      :disabled="busy"
      @click="read(item.id)"
    ><strong>{{ item.title }}</strong><time :datetime="item.createdAt">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</time><small>查看任务记录</small></button></li></ul>
    <p class="notification-note">通知只显示任务状态。受保护内容仍需在打开会话时授权。</p>
  </SidePanel>
</template>

<style scoped>
.notification-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  padding: 8px 2px 16px;
}
.notification-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.notification-list button {
  width: 100%;
  border: 1px solid #e4eae7;
  background: #fff;
  border-radius: 12px;
  padding: 14px;
  text-align: left;
  color: var(--ink);
}
.notification-list button.unread {
  border-color: #cfe3d9;
  background: #f1f7f3;
}
.notification-list strong {
  display: block;
  font-size: 13px;
  line-height: 1.6;
  font-weight: 500;
}
.notification-list time {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin: 6px 0 10px;
}
.notification-list small {
  font-size: 11px;
  color: #507b6b;
}
.notification-empty,
.notification-note {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
  padding: 14px 2px;
}
</style>
