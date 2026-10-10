<script setup lang="ts">
import type { ConversationSummary } from '@t-box/shared'
import type { DeepReadonly } from 'vue'
import { AppIcon, SidePanel } from '@t-box/ui-kit'
import { ref, watch } from 'vue'
import { authorizeResources } from '../../applications/registry'
import { request } from '../../core/network'
import {
  chatBusy,
  chatState,
  newConversation,
  openConversation,
} from './chatStore'
import {
  conversationHistory,
  refreshConversationHistory,
} from './conversationStore'
import ConversationTitleEditor from './ConversationTitleEditor.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const editing = ref<DeepReadonly<ConversationSummary> | null>(null)
const error = ref('')
const busy = ref(false)
watch(
  () => props.open,
  (value) => {
    if (value) {
      error.value = ''
      void refreshConversationHistory()
    }
  },
)
async function enter(item: DeepReadonly<ConversationSummary>) {
  if (busy.value || chatBusy.value) {
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (item.unavailable) {
      throw new Error('此会话涉及已不可访问的应用资源')
    }
    if (!(await authorizeResources(item.protectedResources, '查看会话历史'))) {
      return
    }
    await request(`/conversations/${item.id}`)
    openConversation(item.id)
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法打开会话'
  } finally {
    busy.value = false
  }
}
async function remove(item: DeepReadonly<ConversationSummary>) {
  // eslint-disable-next-line no-alert -- Preserve the existing confirmation before deleting conversation history.
  if (!confirm('删除这段会话历史？已创建的账单和资源仍会保留。')) {
    return
  }
  busy.value = true
  try {
    await request(`/conversations/${item.id}`, { method: 'DELETE' })
    if (chatState.conversationId === item.id) {
      newConversation()
    }
    await refreshConversationHistory()
    if (!conversationHistory.items.length) {
      emit('close')
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <SidePanel
    :open="open"
    title="会话历史"
    :busy="busy"
    @close="emit('close')"
  >
    <p
      v-if="error || conversationHistory.error"
      class="history-error"
      role="alert"
    >
      {{ error || conversationHistory.error
      }}<button class="text-button" @click="refreshConversationHistory">
        重新加载
      </button>
    </p>
    <p
      v-if="conversationHistory.loading && !conversationHistory.items.length"
      class="history-empty"
      role="status"
    >
      正在读取历史…
    </p>
    <ul v-else class="history-list">
      <li
        v-for="item in conversationHistory.items"
        :key="item.id"
        :class="{ current: item.id === chatState.conversationId }"
      >
        <button
          class="history-open"
          :title="item.title"
          :disabled="busy || chatBusy"
          :aria-current="
            item.id === chatState.conversationId ? 'true' : undefined
          "
          @click="enter(item)"
        >
          <span class="history-title"><AppIcon
            v-if="item.protectedResources.length || item.unavailable"
            name="lock"
            :size="14"
          /><strong>{{ item.title }}</strong></span><small>{{
            new Date(item.updatedAt).toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
            })
          }}
            · {{ item.messageCount }} 条消息</small>
        </button><button
          class="icon-button history-edit"
          :disabled="busy || item.unavailable"
          :aria-label="`修改标题：${item.title}`"
          @click="editing = item"
        >
          <AppIcon name="edit" :size="15" />
        </button><button
          class="icon-button history-delete"
          :disabled="busy || chatBusy"
          :aria-label="`删除会话：${item.title}`"
          @click="remove(item)"
        >
          <AppIcon name="trash" :size="16" />
        </button>
      </li>
    </ul>
    <template #footer>
      <span class="history-caption">最近 100 段会话</span>
    </template>
  </SidePanel>
  <ConversationTitleEditor
    :open="!!editing"
    :conversation-id="editing?.id || ''"
    :title="editing?.title || ''"
    :resources="editing?.protectedResources"
    @close="editing = null"
  />
</template>
