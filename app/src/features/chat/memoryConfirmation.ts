import { reactive, readonly } from 'vue'

const state = reactive<{
  proposal: {
    action: 'remember' | 'forget'
    label: string
    content?: string
  } | null
}>({ proposal: null })
let settle: ((approved: boolean) => void) | undefined
export const memoryConfirmation = readonly(state)
export function closeMemoryConfirmation(approved = false) {
  const callback = settle
  settle = undefined
  state.proposal = null
  callback?.(approved)
}
export async function confirmMemory(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('action' in value) ||
    !['remember', 'forget'].includes(String(value.action)) ||
    !('label' in value) ||
    typeof value.label !== 'string' ||
    value.label.length > 80
  ) {
    return { approved: false }
  }
  closeMemoryConfirmation()
  state.proposal = {
    action: value.action as 'remember' | 'forget',
    label: value.label,
    content:
      'content' in value && typeof value.content === 'string'
        ? value.content.slice(0, 800)
        : undefined,
  }
  return {
    approved: await new Promise<boolean>((resolve) => {
      settle = resolve
    }),
  }
}
