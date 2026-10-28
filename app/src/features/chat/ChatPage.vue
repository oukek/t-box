<script setup lang="ts">
import type { ApplicationId, Resource } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import ImageViewer from '../../components/ImageViewer.vue'
import ResourceImage from '../../components/ResourceImage.vue'
import { getApplication } from '../../core/applications'
import {
  downloadResource,
  fileSize,
  uploadResource,
} from '../resources/resourcesApi'
import CustomerSupportEntry from '../support/CustomerSupportEntry.vue'
import AICenterPanel from './AICenterPanel.vue'
import AnswerActions from './AnswerActions.vue'
import ChatComposer from './ChatComposer.vue'
import {
  cancelRun,
  canSendMessage,
  chatBusy,
  chatState,
  dismissUncertainty,
  newConversation,
  openConversation,
  reconnectChat,
  retryAnswer,
  sendMessage,
  takeFailedDraft,
} from './chatStore'
import ConversationHistory from './ConversationHistory.vue'
import {
  conversationHistory,
  refreshConversationHistory,
  resetConversationHistory,
} from './conversationStore'
import ConversationTitleEditor from './ConversationTitleEditor.vue'
import GenerationStatus from './GenerationStatus.vue'
import MessageActions from './MessageActions.vue'
import MessageDeleteDialog from './MessageDeleteDialog.vue'
import MessageExecutionTime from './MessageExecutionTime.vue'
import MessageFooter from './MessageFooter.vue'
import {
  answerCopyText,
  hasFinishedReply,
  taskBlocksNewMessage,
} from './messagePolicy'
import MessageTimeline from './MessageTimeline.vue'
import StreamText from './StreamText.vue'
import TaskPanel from './TaskPanel.vue'
import ToolProgress from './ToolProgress.vue'

const props = defineProps<{ active: boolean }>()
const text = ref('')
const applicationIds = ref<ApplicationId[]>([])
const composer = ref<InstanceType<typeof ChatComposer>>()
const attachments = ref<Resource[]>([])
const previewImage = ref<Resource | null>(null)
const uploading = ref(false)
const uploadError = ref('')
const historyOpen = ref(false)
async function pickFiles(files: File[]) {
  if (uploading.value) {
    return
  }
  if (files.length + attachments.value.length > 4) {
    uploadError.value = '每条消息最多附加 4 个文件'
    return
  }
  uploading.value = true
  uploadError.value = ''
  try {
    for (const file of files) {
      attachments.value.push(await uploadResource(file))
    }
  } catch (cause) {
    uploadError.value = cause instanceof Error ? cause.message : '上传失败'
  } finally {
    uploading.value = false
  }
}
async function download(resource: Resource) {
  try {
    await downloadResource(resource)
  } catch (cause) {
    uploadError.value = cause instanceof Error ? cause.message : '下载失败'
  }
}
const timeline = ref<HTMLDivElement>()
const followLatest = ref(true)
function trackScroll() {
  const box = timeline.value
  if (box) {
    followLatest.value =
      box.scrollHeight - box.scrollTop - box.clientHeight < 90
  }
}
function followRendered() {
  if (props.active && followLatest.value) {
    timeline.value?.scrollTo({ top: timeline.value.scrollHeight })
  }
}
const tasksOpen = ref(false)
const centerOpen = ref(false)
const titleOpen = ref(false)
async function showTasks() {
  centerOpen.value = false
  await nextTick()
  tasksOpen.value = true
}
const currentResources = computed(() =>
  chatState.messages.flatMap((m) => m.resourceRefs || []),
)
const hasMessages = computed(
  () => chatState.messages.length > 0 || Boolean(chatState.pendingText),
)
const needsNewSession = computed(() =>
  [
    'SESSION_EXPIRED',
    'SESSION_INVALID',
    'LEDGER_NOT_FOUND',
    'LEDGER_LOCKED',
    'UNAUTHENTICATED',
  ].includes(chatState.errorCode),
)
onMounted(() => void refreshConversationHistory())
onBeforeUnmount(resetConversationHistory)
watch(
  () => [chatState.conversationId, chatBusy.value] as const,
  ([id, busy]) => {
    if (id && !busy) {
      void refreshConversationHistory()
    }
  },
)
watch(
  () => props.active,
  (active) => {
    if (active) {
      void refreshConversationHistory()
    } else {
      historyOpen.value = false
      tasksOpen.value = false
      centerOpen.value = false
      titleOpen.value = false
      composer.value?.closeMenus()
    }
  },
)
const editingMessage = ref<{
  id: string
  revision?: number
  conversationId: string
} | null>(null)
const deletingMessage = ref<{ id: string, preview: string } | null>(null)
const messageActionsDisabled = computed(
  () =>
    chatBusy.value ||
    chatState.connection !== 'connected' ||
    taskBlocksNewMessage(chatState.task),
)
function beginEdit(message: (typeof chatState.messages)[number]) {
  if (messageActionsDisabled.value || uploading.value || !canSendMessage.value) {
    return
  }
  editingMessage.value = {
    id: message.id,
    revision: chatState.conversationRevision,
    conversationId: chatState.conversationId,
  }
  text.value = message.content
  attachments.value = (message.attachments || []).map((resource) => ({
    ...resource,
  }))
  applicationIds.value = [...(message.applicationIds || [])]
  uploadError.value = ''
  nextTick(() => composer.value?.focus())
}
function cancelEdit() {
  editingMessage.value = null
  text.value = ''
  attachments.value = []
  applicationIds.value = []
}
function submit() {
  if (
    !uploading.value &&
    sendMessage(
      text.value,
      attachments.value,
      applicationIds.value,
      editingMessage.value
        ? {
            sourceMessageId: editingMessage.value.id,
            expectedRevision: editingMessage.value.revision,
          }
        : undefined,
    )
  ) {
    text.value = ''
    attachments.value = []
    applicationIds.value = []
    editingMessage.value = null
  }
}
watch(
  () => chatState.failedDraft?.requestId,
  () => {
    const draft = takeFailedDraft()
    if (!draft) {
      return
    }
    text.value = draft.text
    attachments.value = draft.attachments
    applicationIds.value = draft.applicationIds
    // Admission can fail after switching into the new branch. Retry that draft in the existing branch.
    editingMessage.value =
      draft.sourceMessageId &&
      chatState.messages.some(
        (message) =>
          message.id === draft.sourceMessageId && message.role === 'user',
      )
        ? {
            id: draft.sourceMessageId,
            revision: draft.expectedRevision,
            conversationId: chatState.conversationId,
          }
        : null
  },
)
watch(
  () => chatState.conversationId,
  (id, previous) => {
    if (id === previous) {
      return
    }
    editingMessage.value = null
    deletingMessage.value = null
    text.value = ''
    attachments.value = []
    applicationIds.value = []
  },
)
function deletedMessage(id: string) {
  if (editingMessage.value?.id === id) {
    cancelEdit()
  }
}
function startNew() {
  if (newConversation()) {
    editingMessage.value = null
    deletingMessage.value = null
    followLatest.value = true
    text.value = ''
    attachments.value = []
    applicationIds.value = []
    nextTick(() => composer.value?.focus())
  }
}
function useWelcomePrompt(value: string) {
  text.value = value
  void nextTick(() => composer.value?.focus())
}
watch(
  () => [
    chatState.messages
      .map(
        (message) =>
          `${message.content}:${message.timeline?.map((x) => x.revision).join(',')}:${message.toolCalls.map((tool) => tool.status).join(',')}`,
      )
      .join(''),
    chatState.pendingText,
    props.active,
  ],
  async () => {
    if (!props.active) {
      return
    }
    await nextTick()
    if (followLatest.value) {
      timeline.value?.scrollTo({ top: timeline.value.scrollHeight })
    }
  },
)
</script>

<template>
  <section
    class="chat-page"
    :class="{ 'has-messages': hasMessages }"
    aria-label="首页对话"
  >
    <div class="chat-toolbar">
      <button
        v-if="chatState.conversationId && hasMessages"
        class="conversation-label conversation-title"
        aria-label="修改当前会话标题"
        :title="chatState.title || '当前对话'"
        @click="titleOpen = true"
      >
        <span class="conversation-dot" /><span class="current-title">{{ chatState.title || "当前对话" }}</span><AppIcon name="edit" :size="13" />
      </button>
      <span
        v-else
        class="conversation-label"
      ><span class="conversation-dot" />{{ hasMessages ? "当前对话" : "新对话" }}</span>
      <div class="chat-toolbar-actions">
        <CustomerSupportEntry :active="props.active" />
        <button
          class="new-conversation"
          aria-label="打开 AI 中心"
          @click="centerOpen = true"
        >
          <AppIcon name="apps" :size="17" /><span>AI 中心</span>
        </button>
        <button
          v-if="conversationHistory.items.length"
          class="new-conversation"
          :disabled="chatBusy"
          aria-label="查看会话历史"
          @click="historyOpen = true"
        >
          <AppIcon name="history" :size="17" /><span class="toolbar-text">历史</span>
        </button><button
          v-if="hasMessages"
          class="new-conversation"
          :disabled="chatBusy"
          :title="chatBusy ? '请先停止当前处理，再新建对话' : '开始一段新对话'"
          aria-label="新建对话"
          @click="startNew"
        >
          <AppIcon name="plus" :size="17" /><span class="toolbar-text">新建对话</span>
        </button>
      </div>
    </div>
    <div v-if="chatState.branch" class="branch-notice">
      <span>修改后的对话分支</span><button
        type="button"
        :disabled="chatBusy"
        @click="openConversation(chatState.branch.sourceConversationId)"
      >
        查看原对话<AppIcon name="right" :size="13" />
      </button>
    </div>
    <div
      ref="timeline"
      class="chat-timeline"
      :class="{ 'welcome-timeline': !hasMessages }"
      role="log"
      aria-label="对话消息"
      aria-live="polite"
      aria-relevant="additions text"
      @scroll.passive="trackScroll"
    >
      <div v-if="!hasMessages" class="welcome-content">
        <div class="welcome-symbol" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
        <p class="welcome-eyebrow">T方舟 · 你的日常助手</p>
        <h1>有什么<span>想聊的？</span></h1>
        <p class="welcome-description">
          聊聊想法，安排事情。<br>从一句话开始。
        </p>
        <div class="welcome-prompts" aria-label="对话灵感">
          <button type="button" @click="useWelcomePrompt('帮我整理一下今天要做的事情')">整理今天的安排</button>
          <button type="button" @click="useWelcomePrompt('我想记录一笔日常开销')">记录日常开销</button>
          <button type="button" @click="useWelcomePrompt('我有一个想法，帮我一起梳理一下')">一起梳理想法</button>
        </div>
      </div>
      <div v-else class="conversation-messages">
        <article
          v-for="message in chatState.messages"
          :key="message.id"
          class="chat-message"
          :class="message.role"
        >
          <div class="message-body">
            <span class="sr-only">{{ message.role === "user" ? "你" : "T方舟" }}：</span>
            <div :class="{ 'message-bubble': message.role === 'user' }">
              <div
                v-if="message.applicationIds?.length"
                class="message-app-tags"
              >
                <span
                  v-for="appId in message.applicationIds"
                  :key="appId"
                >@{{ getApplication(appId)?.name || appId }}</span>
              </div>
              <MessageTimeline
                v-if="message.role === 'assistant' && message.timeline?.length"
                :message="message"
                :active="chatState.activeRun?.assistantMessageId === message.id"
                :waiting="chatState.activeRun?.status === 'waiting_client'"
                @rendered="followRendered"
              />
              <StreamText
                v-else-if="message.role === 'assistant' && message.content"
                class="legacy-assistant-text"
                :text="message.content"
                :streaming="
                  chatState.activeRun?.assistantMessageId === message.id
                "
                @rendered="followRendered"
              />
              <p v-else-if="message.content" class="message-text">
                {{ message.content }}
              </p>
              <div v-if="message.attachments?.length" class="message-resources">
                <button
                  v-for="resource in message.attachments"
                  :key="resource.id"
                  class="message-resource"
                  :aria-label="`${resource.mimeType.startsWith('image/') ? '查看大图' : '下载'} ${resource.name}`"
                  @click="
                    resource.mimeType.startsWith('image/')
                      ? (previewImage = resource)
                      : download(resource)
                  "
                >
                  <ResourceImage
                    v-if="resource.mimeType.startsWith('image/')"
                    :resource="resource"
                    @rendered="followRendered"
                  /><span
                    v-else
                    class="message-file"
                  ><AppIcon name="file" :size="23" /><span>{{ resource.name
                  }}<small>{{ fileSize(resource.size) }}</small></span></span>
                </button>
              </div>
            </div>
            <ToolProgress
              v-if="message.role === 'assistant' && !message.timeline?.length"
              :tools="message.toolCalls"
              :active="chatState.activeRun?.assistantMessageId === message.id"
            />
            <GenerationStatus
              v-if="
                message.role === 'assistant'
                  && chatState.activeRun?.assistantMessageId === message.id
                  && !message.timeline?.length
              "
              :waiting="chatState.activeRun?.status === 'waiting_client'"
              @rendered="followRendered"
            />
            <MessageActions
              v-if="message.role === 'user'"
              :text="message.content"
              :created-at="message.createdAt"
              :disabled="
                messageActionsDisabled
                  || !hasFinishedReply(chatState.messages, message.id)
              "
              :can-edit="
                canSendMessage
                  && !uploading
                  && hasFinishedReply(chatState.messages, message.id)
              "
              @edit="beginEdit(message)"
              @delete="
                deletingMessage = { id: message.id, preview: message.content }
              "
            />
            <MessageFooter v-if="message.role === 'assistant'">
              <MessageExecutionTime
                v-if="message.execution"
                :execution="message.execution"
                :active="chatState.activeRun?.assistantMessageId === message.id"
              />
              <AnswerActions
                v-if="
                  message.role === 'assistant'
                    && message.outcome !== 'running'
                    && chatState.activeRun?.assistantMessageId !== message.id
                "
                :text="answerCopyText(message)"
                :copying-disabled="
                  chatState.activeRun?.assistantMessageId === message.id
                "
                :retry-disabled="messageActionsDisabled || !canSendMessage"
                @retry="retryAnswer(message.id)"
              />
            </MessageFooter>
          </div>
        </article>
        <article v-if="chatState.pendingText" class="chat-message user pending">
          <div class="message-body">
            <div class="message-bubble">
              <p class="message-text">
                {{ chatState.pendingText }}
              </p>
              <span class="pending-label">正在发送…</span>
            </div>
          </div>
        </article>
      </div>
    </div>
    <div class="composer-area">
      <div
        v-if="editingMessage"
        class="editing-notice"
        role="status"
      >
        <AppIcon name="edit" :size="16" />
        <div>
          <strong>修改并重新发送</strong><span>创建新分支，原对话保留在历史中。</span>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="取消修改消息"
          @click="cancelEdit"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </div>
      <button
        v-if="
          chatState.task
            && [
              'queued',
              'running',
              'waiting_client',
              'paused',
              'needs_review',
            ].includes(chatState.task.status)
            && !chatBusy
        "
        class="task-resume-notice"
        @click="tasksOpen = true"
      >
        <AppIcon
          :name="
            chatState.task.status === 'needs_review' ? 'warning' : 'history'
          "
          :size="17"
        /><span>{{
          chatState.task.status === "needs_review"
            ? "部分操作需要核对"
            : chatState.task.status === "running"
              ? "后端正在处理任务"
              : chatState.task.status === "waiting_client"
                ? "等待你处理，可继续任务"
                : "任务已暂停，可以继续或发送新消息"
        }}</span><span>查看任务</span>
      </button>
      <p
        v-if="uploadError"
        class="chat-notice"
        role="alert"
      >
        {{ uploadError }}
      </p>
      <div
        v-if="chatState.outcomeUncertain"
        class="chat-notice uncertain-notice"
        role="alert"
      >
        <AppIcon name="warning" :size="18" />
        <p>
          连接中断前的操作结果尚未确认。请先查看账单和已恢复的对话，系统不会自动重复发送。
        </p>
        <button
          class="icon-button"
          aria-label="关闭结果确认提示"
          @click="dismissUncertainty"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </div>
      <div
        v-if="chatState.error"
        class="chat-notice connection-notice"
        role="alert"
      >
        <AppIcon name="connection" :size="18" />
        <p>{{ chatState.error }}</p>
        <button
          v-if="chatState.errorCode === 'AI_NOT_CONFIGURED'"
          @click="reconnectChat"
        > 检查配置</button><button v-else-if="needsNewSession" @click="startNew">新建对话</button><button v-else @click="reconnectChat">重新连接</button>
      </div>
      <div v-if="chatState.storageNotice" class="storage-notice">
        {{ chatState.storageNotice }}
      </div>
      <ChatComposer
        ref="composer"
        v-model="text"
        v-model:application-ids="applicationIds"
        :max-message-length="chatState.maxMessageLength"
        :attachments="attachments"
        :can-send="canSendMessage"
        :busy="chatBusy"
        :can-stop="
          !!chatState.activeRun && chatState.connection === 'connected'
        "
        :cancelling="chatState.cancelling"
        :uploading="uploading"
        :mode="chatState.mode"
        @send="submit"
        @stop="cancelRun"
        @files="pickFiles"
        @remove-attachment="
          (id) =>
            (attachments = attachments.filter((resource) => resource.id !== id))
        "
      />
      <div class="composer-caption">
        <span v-if="chatState.connection !== 'connected'">{{
          chatState.connection === "offline"
            ? "对话服务尚未连接"
            : "正在连接对话服务…"
        }}</span>
        <span v-else-if="chatState.mode === 'unconfigured'">尚未接入 AI，请在后台配置并启用普通会话模型。<button
          type="button"
          class="chat-config-refresh"
          @click="reconnectChat"
        >
          检查配置
        </button></span>
        <span class="keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
      </div>
    </div>
    <MessageDeleteDialog
      :open="!!deletingMessage"
      :message-id="deletingMessage?.id || ''"
      :preview="deletingMessage?.preview || ''"
      @close="deletingMessage = null"
      @deleted="deletedMessage"
    />
    <ConversationHistory :open="historyOpen" @close="historyOpen = false" />
    <ImageViewer :resource="previewImage" @close="previewImage = null" />
    <TaskPanel :open="tasksOpen" @close="tasksOpen = false" />
    <AICenterPanel
      :open="centerOpen"
      @close="centerOpen = false"
      @tasks="showTasks"
    />
    <ConversationTitleEditor
      :open="titleOpen"
      :conversation-id="chatState.conversationId"
      :title="chatState.title || '当前对话'"
      :resources="currentResources"
      @close="titleOpen = false"
    />
  </section>
</template>

<style scoped>
.branch-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 20px 8px;
  font-size: 11px;
  color: #85968c;
}
.branch-notice button {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: #5e8270;
  font-size: 11px;
  cursor: pointer;
  padding: 6px 0;
}
.branch-notice button:disabled {
  opacity: 0.4;
  cursor: default;
}
.editing-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 11px 12px;
  background: #f0f5f1;
  border: 1px solid #dfe9e1;
  border-radius: 12px;
  color: #587b69;
}
.editing-notice > div {
  display: grid;
  gap: 3px;
  flex: 1;
}
.editing-notice strong {
  font-size: 12px;
  font-weight: 600;
}
.editing-notice span {
  font-size: 11px;
  color: #8a9d90;
}

.legacy-assistant-text {
  padding-top: 5px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--ink);
}
.conversation-title {
  border: 0;
  background: transparent;
  padding: 5px 0;
  text-align: left;
  min-width: 0;
  flex: 1;
  cursor: pointer;
}
.conversation-title .current-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-title svg {
  flex-shrink: 0;
  opacity: 0.6;
}
.conversation-title .conversation-dot {
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .toolbar-text {
    display: none;
  }
  .chat-toolbar-actions {
    flex-shrink: 0;
  }
}

.task-resume-notice {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 11px 12px;
  margin-bottom: 10px;
  border: 1px solid #dce9e6;
  border-radius: 12px;
  background: #f2f8f6;
  color: #3d7168;
  font-size: 12px;
  text-align: left;
}
.task-resume-notice > span:first-of-type {
  flex: 1;
}
.task-resume-notice > span:last-of-type {
  font-size: 11px;
}
</style>
