<script setup lang="ts">
import type { NotificationAction, SystemNotification } from '@t-box/app-contracts'
import { AppIcon, Modal, SidePanel } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'
import { getApplication } from '../../core/applications'
import { identity } from '../../core/session'
import { openNotificationTarget } from './navigation'
import NotificationImage from './NotificationImage.vue'
import { loadNotifications, markNotification, notifications } from './store'

const selected = ref<SystemNotification | null>(null)
const busy = ref(false)
const error = ref('')
const icons = { info: 'info', success: 'check', warning: 'warning', action: 'task', image: 'image' }
const labels = { info: '消息', success: '已完成', warning: '需留意', action: '待处理', image: '图片' }
const empty = computed(() => notifications.filter === 'unread' ? '未读通知已处理完' : '暂无通知')
const source = (item: SystemNotification) => item.sourceAppId === 'system' ? '系统' : getApplication(item.sourceAppId)?.name || (item.sourceAppId === 'images' ? '图片助手' : '应用')
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
watch(() => identity.user?.id, () => {
  selected.value = null
  error.value = ''
  busy.value = false
})
watch(() => notifications.open, (open) => {
  if (!open) {
    selected.value = null
  }
})
function filter(value: 'all' | 'unread') {
  if (notifications.filter !== value) {
    notifications.filter = value
    void loadNotifications()
  }
}
async function read(id?: string, value = true) {
  if (busy.value) {
    return
  }
  const user = identity.user?.id
  busy.value = true
  error.value = ''
  try {
    await markNotification(id, value)
    if (identity.user?.id === user && selected.value && (!id || selected.value.id === id)) {
      selected.value = { ...selected.value, read: value }
    }
  } catch (cause) {
    if (identity.user?.id === user) {
      error.value = cause instanceof Error ? cause.message : '通知更新失败'
    }
  } finally {
    if (identity.user?.id === user) {
      busy.value = false
    }
  }
}
function detail(item: SystemNotification) {
  error.value = ''
  selected.value = { ...item }
  if (!item.read) {
    void read(item.id)
  }
}
async function act(action: NotificationAction) {
  if (busy.value) {
    return
  }
  const user = identity.user?.id
  busy.value = true
  error.value = ''
  // Close the detail before a target may ask for a password in another modal.
  const item = selected.value
  selected.value = null
  try {
    if (await openNotificationTarget(action.target)) {
      notifications.open = false
    } else if (identity.user?.id === user) {
      selected.value = item
    }
  } catch (cause) {
    if (identity.user?.id === user) {
      selected.value = item
      error.value = cause instanceof Error ? cause.message : '目标暂时无法打开'
    }
  } finally {
    if (identity.user?.id === user) {
      busy.value = false
    }
  }
}
</script>

<template>
  <SidePanel
    :open="notifications.open"
    title="通知"
    class="notification-panel"
    @close="notifications.open = false"
  >
    <div class="notification-toolbar">
      <div
        class="notification-filters"
        role="group"
        aria-label="筛选通知"
      >
        <button :aria-pressed="notifications.filter === 'all'" @click="filter('all')">全部</button>
        <button :aria-pressed="notifications.filter === 'unread'" @click="filter('unread')">未读 <span v-if="notifications.unread">{{ notifications.unread }}</span></button>
      </div>
      <button
        class="notification-text-button"
        :disabled="busy || !notifications.unread"
        @click="read()"
      >全部已读</button>
    </div>
    <p
      v-if="notifications.error || (error && !selected)"
      class="form-error"
      role="alert"
    >{{ notifications.error || error }} <button class="notification-text-button" @click="loadNotifications()">重试</button></p>
    <div
      v-if="!notifications.items.length"
      class="notification-empty"
      role="status"
    >
      <AppIcon name="bell" :size="28" />
      <strong>{{ notifications.loading ? '正在读取通知…' : empty }}</strong>
      <p v-if="!notifications.loading">任务进展、应用消息与日程提醒会显示在这里。</p>
    </div>
    <ol
      v-else
      class="notification-list"
      aria-label="通知列表"
    >
      <li
        v-for="item in notifications.items"
        :key="item.id"
        class="notification-item"
        :class="[`notification-item--${item.style}`, { 'notification-item--unread': !item.read }]"
      >
        <button class="notification-summary" @click="detail(item)">
          <span class="notification-kind"><AppIcon :name="icons[item.style]" :size="18" /></span>
          <span class="notification-copy">
            <span class="notification-meta"><span>{{ source(item) }} · {{ labels[item.style] }}</span><time :datetime="item.createdAt">{{ time(item.createdAt) }}</time></span>
            <strong>{{ item.title }}<i
              v-if="!item.read"
              class="notification-dot"
              aria-label="未读"
            /></strong>
            <span v-if="item.body" class="notification-body">{{ item.body }}</span>
            <span v-if="item.actions.length" class="notification-link">{{ item.actions[0].label }}<AppIcon name="right" :size="12" /></span>
          </span>
        </button>
        <button
          class="notification-read"
          :aria-label="item.read ? '标为未读' : '标为已读'"
          :title="item.read ? '标为未读' : '标为已读'"
          :disabled="busy"
          @click="read(item.id, !item.read)"
        ><AppIcon :name="item.read ? 'history' : 'check'" :size="15" /></button>
      </li>
    </ol>
    <button
      v-if="notifications.nextCursor"
      class="notification-load"
      :disabled="notifications.loading"
      @click="loadNotifications(true)"
    >{{ notifications.loading ? '正在读取…' : '加载更多' }}</button>
    <template #footer><p class="notification-footer">已读表示你看过消息，待处理事项仍需进入应用完成。</p></template>
  </SidePanel>
  <Modal
    :open="!!selected"
    :title="selected?.title || '通知详情'"
    @close="selected = null"
  >
    <template v-if="selected">
      <p class="notification-detail-meta">{{ source(selected) }} · {{ time(selected.createdAt) }}</p>
      <NotificationImage
        v-if="selected.imageResourceId"
        :id="selected.imageResourceId"
        :title="selected.title"
      />
      <p v-if="selected.body" class="notification-detail-body">{{ selected.body }}</p>
      <p
        v-if="error"
        class="form-error"
        role="alert"
      >{{ error }}</p>
    </template>
    <template #footer>
      <button
        v-for="action in selected?.actions || []"
        :key="action.label"
        class="primary-button"
        :disabled="busy"
        @click="act(action)"
      >{{ action.label }}</button>
      <button class="secondary-button" @click="selected = null">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.notification-panel.side-panel {
  width: 420px;
  max-width: calc(100vw - 32px);
}
.notification-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 12px;
}
.notification-filters {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  background: #edf2f1;
}
.notification-filters button {
  border: 0;
  border-radius: 7px;
  background: transparent;
  padding: 6px 10px;
  color: var(--muted);
  font-size: 12px;
}
.notification-filters button[aria-pressed='true'] {
  background: #fff;
  color: var(--ink);
}
.notification-filters span {
  margin-left: 3px;
  font-variant-numeric: tabular-nums;
}
.notification-text-button {
  border: 0;
  background: transparent;
  color: #3c7468;
  padding: 6px 2px;
  font-size: 12px;
}
.notification-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.notification-item {
  position: relative;
  border-bottom: 1px solid #e4ebe8;
  --notification-accent: #648279;
}
.notification-item--success {
  --notification-accent: #267763;
}
.notification-item--warning {
  --notification-accent: #ad7028;
}
.notification-item--action {
  --notification-accent: #426c9a;
}
.notification-item--image {
  --notification-accent: #82627a;
}
.notification-item--unread {
  background: #f0f6f3;
  border-radius: 10px;
}
.notification-summary {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 14px 32px 14px 8px;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
}
.notification-kind {
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  height: 30px;
  border: 1px solid #dbe6e1;
  border-radius: 9px;
  color: var(--notification-accent);
  background: #fff;
}
.notification-copy {
  flex: 1;
  min-width: 0;
}
.notification-meta {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 5px;
  font-size: 10px;
  color: var(--muted);
}
.notification-meta time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.notification-copy strong {
  display: block;
  font-size: 13px;
  line-height: 1.6;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.notification-body {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
.notification-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: #327a66;
  vertical-align: middle;
}
.notification-link {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 7px;
  font-size: 11px;
  color: var(--notification-accent);
}
.notification-read {
  position: absolute;
  right: 3px;
  top: 36px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
}
.notification-read:hover {
  background: #e4ede9;
}
.notification-load {
  width: 100%;
  padding: 12px;
  margin-top: 10px;
  border: 1px solid #dce6e1;
  border-radius: 8px;
  background: #fff;
  color: var(--ink);
  font-size: 12px;
}
.notification-empty {
  display: grid;
  justify-items: center;
  padding: 54px 14px;
  text-align: center;
  color: var(--muted);
  gap: 12px;
}
.notification-empty strong {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink);
}
.notification-empty p,
.notification-footer {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}
.notification-detail-meta {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--muted);
}
.notification-detail-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  font-size: 14px;
}
.notification-summary:focus-visible,
.notification-read:focus-visible,
.notification-filters button:focus-visible {
  outline: 2px solid #327a66;
  outline-offset: -2px;
}
@media (max-width: 700px) {
  .notification-panel.side-panel {
    width: 100vw;
    max-width: 100vw;
  }
  .notification-read {
    width: 44px;
    height: 44px;
  }
  .notification-summary {
    padding-right: 46px;
  }
}
</style>
