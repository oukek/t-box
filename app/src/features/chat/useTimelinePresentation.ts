import type { ChatMessage } from '@t-box/shared'
import type { DeepReadonly } from 'vue'
import { computed, ref, watch } from 'vue'
import { isVisibleConversationTool } from './toolPresentation'

/** Presentation only: never change persisted timeline ordering or execution state. */
export function useTimelinePresentation(props: {
  message: DeepReadonly<ChatMessage>
  active: boolean
}) {
  const manualExpanded = ref<boolean>()
  const items = computed(() =>
    [...(props.message.timeline || [])]
      .filter((item) =>
        (item.kind !== 'analysis' || item.label !== '结果核对') &&
        (item.kind !== 'tool' || isVisibleConversationTool(item.tool)),
      )
      .sort((a, b) => a.sequence - b.sequence),
  )
  const answerIndex = computed(() => items.value.findIndex((item) => item.kind === 'answer'))
  const boundary = computed(() => {
    if (answerIndex.value >= 0) {
      return answerIndex.value
    }
    // Keep the terminal failure/waiting notice visible even when the process is folded.
    const last = items.value.at(-1)
    if (!props.active && last?.kind === 'notice' && last.label !== '自动重试') {
      return items.value.length - 1
    }
    return items.value.length
  })
  const process = computed(() => items.value.slice(0, boundary.value))
  const tail = computed(() => items.value.slice(boundary.value))
  const completed = computed(() =>
    !props.active &&
    answerIndex.value >= 0 &&
    tail.value[0]?.kind === 'answer' &&
    tail.value[0].status === 'completed' &&
    !['paused', 'failed', 'cancelled'].includes(props.message.outcome || ''),
  )
  const expanded = computed(() => manualExpanded.value ?? !completed.value)
  watch(
    () => [props.message.id, props.message.answerRevision, props.message.execution?.startedAt, props.active] as const,
    (current, previous) => {
      if (!previous || current.slice(0, 3).some((value, index) => value !== previous[index]) || (current[3] && !previous[3])) {
        manualExpanded.value = undefined
      }
    },
  )
  const visible = computed(() => expanded.value ? items.value : tail.value)
  const toggle = () => {
    manualExpanded.value = !expanded.value
  }
  return { items, process, completed, expanded, visible, toggle }
}
