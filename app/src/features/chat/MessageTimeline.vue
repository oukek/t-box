<script setup lang="ts">
import type { ChatMessage } from '@t-box/shared'
import type { DeepReadonly } from 'vue'
import { AppIcon } from '@t-box/ui-kit'
import { computed, ref, watch } from 'vue'
import { MarkdownPreview } from '../../components/markdown-preview'
import GenerationStatus from './GenerationStatus.vue'
import ImageGenerationPreview from './ImageGenerationPreview.vue'
import StreamText from './StreamText.vue'
import { isVisibleConversationTool } from './toolPresentation'

const props = defineProps<{
  message: DeepReadonly<ChatMessage>
  active: boolean
  waiting?: boolean
}>()
const emit = defineEmits<{ rendered: [] }>()
const expanded = ref(true)
const items = computed(() =>
  [...(props.message.timeline || [])]
    .filter(
      (item) =>
        (item.kind !== 'analysis' || item.label !== '结果核对') &&
        (item.kind !== 'tool' || isVisibleConversationTool(item.tool)),
    )
    .sort((a, b) => a.sequence - b.sequence),
)
const answerIndex = computed(() =>
  items.value.findIndex((x) => x.kind === 'answer'),
)
// Fold only the prefix before the final answer; later interruptions retain their chronological position.
const process = computed(() =>
  answerIndex.value < 0 ? items.value : items.value.slice(0, answerIndex.value),
)
const tail = computed(() =>
  answerIndex.value < 0 ? [] : items.value.slice(answerIndex.value),
)
const completed = computed(
  () =>
    !props.active &&
    answerIndex.value >= 0 &&
    tail.value[0]?.kind === 'answer' &&
    tail.value[0].status === 'completed' &&
    !['paused', 'failed', 'cancelled'].includes(props.message.outcome || ''),
)
watch(
  completed,
  (done) => {
    expanded.value = !done
  },
  { immediate: true },
)
const labels = {
  reasoning: '思考摘要',
  analysis: '分析',
  answer: '回复',
  notice: '提示',
}
const statusLabels = {
  running: '执行中',
  waiting_client: '等待确认',
  completed: '已完成',
  failed: '未完成',
}
const visible = computed(() =>
  expanded.value ? [...process.value, ...tail.value] : tail.value,
)
const progressLabel = computed(() => {
  const last = items.value.at(-1)
  if (last?.kind === 'tool' && last.tool.status === 'running') {
    return `正在${last.tool.title}…`
  }
  if (last?.kind === 'analysis' && last.status === 'streaming') {
    return last.label === '整理上下文' ? '正在整理上下文…' : '正在分析…'
  }
  if (last?.kind === 'answer' && last.status === 'streaming') {
    return '正在生成回答…'
  }
  return '生成中…'
})
</script>

<template>
  <div class="message-timeline">
    <button
      v-if="completed && process.length"
      class="process-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <AppIcon name="check" :size="14" />
      <span>{{ expanded ? "收起处理过程" : "查看处理过程" }}</span>
      <small>{{ process.length }} 个步骤</small>
      <AppIcon
        name="down"
        :size="14"
        class="process-chevron"
        :class="{ expanded }"
      />
    </button>
    <ol class="execution-timeline" aria-label="按时间排列的处理过程">
      <li
        v-for="item in visible"
        :key="item.id"
        class="timeline-entry"
        :class="[
          item.kind,
          {
            'is-streaming':
              item.kind !== 'tool' && item.status === 'streaming' && active,
          },
        ]"
        :data-sequence="item.sequence"
      >
        <template v-if="item.kind === 'tool'">
          <span
            class="timeline-marker"
            aria-hidden="true"
          ><AppIcon
            v-if="item.tool.status === 'completed'"
            name="check"
            :size="12"
          /><AppIcon
            v-else-if="item.tool.status === 'failed'"
            name="warning"
            :size="12"
          /><span v-else class="spinner small" /></span>
          <div class="timeline-detail">
            <div class="timeline-heading">
              <span>使用工具</span><strong>{{ item.tool.title }}</strong><small>{{ statusLabels[item.tool.status] }}</small>
            </div>
            <MarkdownPreview
              v-if="item.tool.summary"
              :text="item.tool.summary"
              class="timeline-tool-summary"
              @rendered="emit('rendered')"
            />
            <span
              v-if="item.agentTitle && item.agentId !== 'assistant'"
              class="timeline-agent"
            >{{ item.agentTitle }}</span>
            <ImageGenerationPreview
              v-if="
                item.tool.preview?.kind === 'image'
                  && item.tool.status !== 'completed'
              "
              :preview="item.tool.preview"
              :status="item.tool.status"
              :active="active"
              @rendered="emit('rendered')"
            />
          </div>
        </template>
        <template v-else>
          <span
            v-if="item.kind !== 'answer'"
            class="timeline-marker text-marker"
            aria-hidden="true"
          ><AppIcon
            :name="item.kind === 'notice' ? 'warning' : 'sparkle'"
            :size="12"
          /></span>
          <div class="timeline-detail">
            <div v-if="item.kind !== 'answer'" class="timeline-heading">
              <span>{{ item.label || labels[item.kind] }}</span><small v-if="item.agentTitle && item.agentId !== 'assistant'">{{
                item.agentTitle
              }}</small><small v-if="item.status === 'interrupted'">已中断</small>
            </div>
            <div class="timeline-text">
              <StreamText
                :text="item.text"
                :streaming="active && item.status === 'streaming'"
                @rendered="emit('rendered')"
              />
            </div>
          </div>
        </template>
      </li>
    </ol>
    <GenerationStatus
      v-if="active"
      :label="progressLabel"
      :waiting="waiting"
      @rendered="emit('rendered')"
    />
  </div>
</template>

<style scoped>
.message-timeline {
  min-width: 0;
}
.process-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: #f2f6f4;
  color: #618277;
  padding: 6px 7px;
  min-height: 30px;
  border-radius: 9px;
  font-size: 11px;
  line-height: 16px;
  margin-bottom: 14px;
  max-width: 100%;
}
.process-toggle small {
  color: #8b9b94;
  font-size: 10px;
  white-space: nowrap;
}
.process-chevron {
  display: block;
  flex-shrink: 0;
  transform: rotate(0deg);
}
.process-chevron.expanded {
  transform: rotate(180deg);
}
.execution-timeline {
  list-style: none;
  padding: 0;
  margin: 0;
}
.timeline-entry {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 0 0 18px;
  min-width: 0;
}
.timeline-entry:not(.answer):not(:last-child)::before {
  content: '';
  position: absolute;
  top: 20px;
  bottom: 2px;
  left: 8px;
  width: 1px;
  background: #e1eae5;
}
.timeline-marker {
  width: 17px;
  height: 19px;
  flex: 0 0 17px;
  display: grid;
  place-items: center;
  color: #4a8978;
}
.timeline-marker .spinner {
  width: 11px;
  height: 11px;
}
.text-marker {
  color: #8b9d95;
}
.timeline-detail {
  flex: 1;
  min-width: 0;
}
.timeline-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px 8px;
  font-size: 11px;
  line-height: 1.8;
  color: #7b9087;
}
.timeline-heading strong {
  font-size: 12px;
  color: #3a5e50;
  font-weight: 500;
}
.timeline-heading small {
  font-size: 10px;
  color: #91a097;
}
.timeline-text {
  margin: 5px 0 0;
  font-size: 13px;
  line-height: 1.85;
  color: #586a61;
}
.timeline-tool-summary {
  font-size: 11px;
  line-height: 1.7;
  color: #87988f;
  margin: 3px 0 0;
  overflow-wrap: anywhere;
}
.timeline-agent {
  display: inline-block;
  font-size: 9px;
  color: #96a69d;
  margin-top: 3px;
}
.timeline-entry.answer {
  padding: 0 0 3px;
}
.answer .timeline-text {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.9;
}
.notice .timeline-text {
  color: #976c4f;
  font-size: 12px;
}
.process-toggle:focus-visible {
  outline: 2px solid #80ad9d;
  outline-offset: 3px;
}
</style>
