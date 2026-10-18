import { ref } from 'vue'
import { ErrorCode } from './error-codes.js'

export const calendarConfirmation = ref<{
  title: string
  message: string
} | null>(null)
let resolve: ((value: { approved: boolean }) => void) | undefined
export function requestCalendarConfirmation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ErrorCode.INTERNAL_INVALID_CONFIRMATION_ARGUMENTS()
  }
  const args = value as Record<string, unknown>
  if (
    Object.keys(args).some((k) => !['title', 'message'].includes(k)) ||
    typeof args.title !== 'string' ||
    args.title.length > 100 ||
    typeof args.message !== 'string' ||
    args.message.length > 1000
  ) {
    throw ErrorCode.INTERNAL_INVALID_CONFIRMATION_CONTENT()
  }
  if (resolve) {
    throw ErrorCode.INTERNAL_CONFIRMATION_PENDING()
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
