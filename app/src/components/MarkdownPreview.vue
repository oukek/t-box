<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { copyText } from '../core/clipboard'
import { createMarkdownRenderer } from '../core/markdown'
import './markdown.css'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{ rendered: [] }>()
// Lazily shared by preview instances. No HTML is persisted or compiled as a Vue template.
const html = computed(() => renderMarkdown(props.text))
watch(html, () => emit('rendered'), { flush: 'post' })
onMounted(() => emit('rendered'))
const root = ref<HTMLDivElement>()
const feedback = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
let disposed = false
async function click(event: MouseEvent) {
  const target = event.target as Element
  const button = target.closest<HTMLButtonElement>('button.md-copy-code')
  if (!button || !root.value?.contains(button)) {
    return
  }
  const code = button
    .closest('.md-code-block')
    ?.querySelector('pre code')
    ?.textContent
  if (code == null) {
    return
  }
  try {
    await copyText(code.replace(/\n$/, ''))
    if (disposed || !button.isConnected) {
      return
    }
    button.textContent = '已复制'
  } catch {
    if (disposed || !button.isConnected) {
      return
    }
    button.textContent = '复制失败'
  }
  clearTimeout(feedback.get(button))
  feedback.set(
    button,
    setTimeout(() => {
      if (button.isConnected) {
        button.textContent = '复制'
      }
      feedback.delete(button)
    }, 1800),
  )
}
onBeforeUnmount(() => {
  disposed = true
  for (const timer of feedback.values()) {
    clearTimeout(timer)
  }
})
</script>

<script lang="ts">
// Module scope avoids creating sanitizer instances on every timeline item or stream delta.
let render: ReturnType<typeof createMarkdownRenderer> | undefined
function renderMarkdown(text: string) {
  return (render ??= createMarkdownRenderer(window))(text)
}
</script>

<template>
  <div
    ref="root"
    class="markdown-preview"
    @click="click"
    @load.capture="emit('rendered')"
    v-html="html"
  />
</template>
