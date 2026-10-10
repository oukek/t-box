import { createRequestId } from '@t-box/app-shell-sdk'
import { ref } from 'vue'
import { invalidateBook } from '../books/bookStore'
import { request } from '../sdk'

export const featureApi = (book: string) => {
  const root = `/ledgers/${encodeURIComponent(book)}`
  return {
    async get<T = any>(path: string) {
      return (await request<{ data: T }>(root + path)).data
    },
    async write<T = any>(
      path: string,
      body: unknown = {},
      method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
      key = createRequestId(),
    ) {
      const response = await request<{ data: T }>(root + path, {
        method,
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': key },
      })
      invalidateBook(book)
      return response.data
    },
  }
}
export function useFeatureAction() {
  const busy = ref(false)
  const error = ref('')
  const success = ref('')
  let fingerprint = ''
  let key = createRequestId()
  return {
    busy,
    error,
    success,
    async run<T>(
      identity: string,
      input: unknown,
      work: (key: string) => Promise<T>,
    ) {
      if (busy.value) {
        return
      }
      const body = JSON.stringify({ identity, input })
      if (body !== fingerprint) {
        fingerprint = body
        key = createRequestId()
      }
      busy.value = true
      error.value = ''
      success.value = ''
      try {
        const result = await work(key)
        fingerprint = ''
        success.value = '操作已完成'
        return result
      } catch (e) {
        error.value = e instanceof Error ? e.message : '操作失败'
      } finally {
        busy.value = false
      }
    },
  }
}
