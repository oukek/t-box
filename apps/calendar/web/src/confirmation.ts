import { ref } from 'vue'

export const calendarConfirmation = ref<{
  title: string
  message: string
} | null>(null)
let resolve: ((value: { approved: boolean }) => void) | undefined
export function requestCalendarConfirmation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('确认参数无效')
  }
  const args = value as Record<string, unknown>
  if (
    Object.keys(args).some((k) => !['title', 'message'].includes(k)) ||
    typeof args.title !== 'string' ||
    args.title.length > 100 ||
    typeof args.message !== 'string' ||
    args.message.length > 1000
  ) {
    throw new Error('确认内容无效')
  }
  if (resolve) {
    throw new Error('已有确认待处理')
  }
  calendarConfirmation.value = { title: args.title, message: args.message }
  return new Promise<{ approved: boolean }>((done) => {
    resolve = done
  })
}
export function resolveCalendarConfirmation(approved: boolean) {
  const done = resolve
  resolve = undefined
  calendarConfirmation.value = null
  done?.({ approved })
}
