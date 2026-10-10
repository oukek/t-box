<script setup lang="ts">
import type { ToolCallView } from '@t-box/shared'
import { AppIcon } from '@t-box/ui-kit'
import { computed } from 'vue'
import { MarkdownPreview } from '../../components/markdown-preview'
import ImageGenerationPreview from './ImageGenerationPreview.vue'
import { isVisibleConversationTool } from './toolPresentation'

const props = defineProps<{
  tools: readonly ToolCallView[]
  active?: boolean
}>()
const visibleTools = computed(() =>
  props.tools.filter(isVisibleConversationTool),
)
const statusLabels = {
  running: '处理中',
  waiting_client: '等待确认',
  completed: '已完成',
  failed: '未完成',
}
</script>

<template>
  <ol
    v-if="visibleTools.length"
    class="tool-progress"
    aria-label="处理进度"
  >
    <li
      v-for="tool in visibleTools"
      :key="tool.id"
      :class="tool.status"
    >
      <span class="tool-status-icon"><AppIcon
        v-if="tool.status === 'completed'"
        name="check"
        :size="15"
      /><AppIcon
        v-else-if="tool.status === 'failed'"
        name="warning"
        :size="15"
      /><span v-else class="spinner small" /></span>
      <div>
        <span class="tool-title">{{ tool.title }}</span>
        <MarkdownPreview
          v-if="tool.summary"
          :text="tool.summary"
          class="tool-summary"
        />
        <ImageGenerationPreview
          v-if="tool.preview?.kind === 'image' && tool.status !== 'completed'"
          :preview="tool.preview"
          :status="tool.status"
          :active="!!active"
        />
      </div>
      <span class="tool-status-label">{{ statusLabels[tool.status] }}</span>
    </li>
  </ol>
</template>
