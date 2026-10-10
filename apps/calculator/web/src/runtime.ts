import { reactive } from 'vue'

export const runtime = reactive({
  subject: '',
  kind: 'scientific',
  expression: '',
  initialHistory: null as unknown,
  revision: 0,
})

// eslint-disable-next-line import/no-mutable-exports -- Shell adapters replace this live binding when history persistence becomes available.
export let persistHistory: ((records: unknown) => Promise<unknown>) | undefined
export function bindHistory(writer: (records: unknown) => Promise<unknown>) {
  persistHistory = writer
}
