import type { ApplicationContext, ApplicationFile } from '@t-box/app-contracts'
import type { AppClient } from '@t-box/app-sdk'
import type {
  BabyProfile,
  BabyRecord,
  BabyScope,
  BabyVisibility,
  CreativeFrame,
  CreativeProject,
} from '@t-box/baby-diary-contracts'
import { BabyErrorCode, mediaScope } from '@t-box/baby-diary-contracts'
import { dayjs } from '@t-box/dayjs'
import { computed, reactive, shallowRef } from 'vue'

let client: AppClient
let epoch = 0
const clearListeners = new Set<() => void>()
export const runtime = reactive({
  subject: '',
  nickname: '',
  params: {} as Record<string, string>,
  active: true,
  careAvailable: false,
})
export function configureRuntime(
  value: AppClient,
  context: ApplicationContext,
  nickname: string,
) {
  client = value
  // Local contexts intentionally carry no backend grants. Version is a UI hint only;
  // every care read/write is still authorized against the live installation and membership.
  const [major = 1, minor = 2] = (context.applicationVersion ?? '1.2.0').split('.').map(Number)
  runtime.careAvailable = major > 1 || (major === 1 && minor >= 2)
  runtime.subject = context.subject
  runtime.nickname = nickname
  runtime.params = { ...context.params }
  client.runtime.onNavigate((params) => {
    runtime.params = { ...params }
  })
  const clear = () => {
    epoch++
    runtime.active = false
    runtime.subject = ''
    for (const listener of clearListeners) {
      listener()
    }
  }
  client.runtime.onClose(clear)
  client.auth.onChange((session) => {
    if (session.subject !== runtime.subject || session.status !== 'signed_in') {
      clear()
    }
  })
}
export const host = () => client
export function onPrivateClear(listener: () => void) {
  clearListeners.add(listener)
  return () => clearListeners.delete(listener)
}
export async function invoke<T>(
  method: string,
  args: unknown = {},
  idempotencyKey?: string,
): Promise<T> {
  if (!runtime.active) {
    throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
  }
  const version = epoch
  const result = await client.api.invoke<T>(method, args, { idempotencyKey })
  if (version !== epoch) {
    throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
  }
  return result
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试'
export const babies = shallowRef<BabyProfile[]>([])
export const selectedId = shallowRef('')
export const baby = computed(() =>
  babies.value.find((row) => row.id === selectedId.value),
)
export const manager = computed(
  () => !!baby.value && ['owner', 'admin'].includes(baby.value.role),
)
export const writable = computed(
  () => !!baby.value && baby.value.role !== 'viewer' && !baby.value.archived,
)
export const today = () =>
  dayjs()
    .tz(baby.value?.timezone || 'Asia/Shanghai')
    .format('YYYY-MM-DD')
export const canScope = (scope: BabyScope) =>
  !!baby.value?.scopes.includes(scope)
export const canEdit = (author: string) =>
  writable.value && (manager.value || author === runtime.subject)
export async function loadBabies() {
  try {
    babies.value = await invoke<BabyProfile[]>('babies_list')
    await client.storage.set('care-profiles-v1', babies.value)
  } catch (cause) {
    const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0
    if (status && status < 500) {
      throw cause
    }
    const cached = await client.storage.get<BabyProfile[]>('care-profiles-v1')
    if (!runtime.active || !Array.isArray(cached) || !cached.length) {
      throw cause
    }
    babies.value = cached
  }
  if (!babies.value.some((row) => row.id === selectedId.value)) {
    selectedId.value = babies.value[0]?.id || ''
  }
}
export async function refreshBaby() {
  if (!selectedId.value) {
    return
  }
  const current = await invoke<BabyProfile>('babies_get', {
    babyId: selectedId.value,
  })
  babies.value = babies.value.map((row) =>
    row.id === current.id ? current : row,
  )
}
export const base = () => ({ babyId: selectedId.value })
export interface RecordPage {
  records: BabyRecord[]
  next: { date: string, createdAt: string, id: string } | null
}
export interface ProjectDetail {
  project: CreativeProject
  frames: CreativeFrame[]
  assets: ApplicationFile[]
}
export const scope = (category: BabyScope, visibility: BabyVisibility) => ({
  type: mediaScope(category, visibility),
  id: selectedId.value,
})

interface CachedImage {
  url: string
  size: number
}
const images = new Map<string, CachedImage>()
const pending = new Map<string, Promise<string>>()
let cachedBytes = 0
export function clearImages() {
  epoch++
  for (const value of images.values()) {
    URL.revokeObjectURL(value.url)
  }
  images.clear()
  pending.clear()
  cachedBytes = 0
}
/** Memory only. Never persist private pictures into localStorage, IndexedDB or the service worker. */
export async function imageUrl(id: string) {
  const cached = images.get(id)
  if (cached) {
    images.delete(id)
    images.set(id, cached)
    return cached.url
  }
  const running = pending.get(id)
  if (running) {
    return running
  }
  const version = epoch
  const task = client.files.private
    .read(id)
    .then(({ blob }) => {
      if (version !== epoch) {
        throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
      }
      const url = URL.createObjectURL(blob)
      images.set(id, { url, size: blob.size })
      cachedBytes += blob.size
      // Cache only 24 previews / 48 MB. The animation preloads its next frame, not the whole project.
      while (images.size > 24 || cachedBytes > 48 * 1024 ** 2) {
        const oldest = images.keys().next().value
        if (!oldest || oldest === id) {
          break
        }
        const entry = images.get(oldest)!
        images.delete(oldest)
        cachedBytes -= entry.size
        URL.revokeObjectURL(entry.url)
      }
      return url
    })
    .finally(() => {
      if (pending.get(id) === task) {
        pending.delete(id)
      }
    })
  pending.set(id, task)
  return task
}
export async function downloadFile(id: string) {
  const { blob, file } = await client.files.private.read(id, {
    original: true,
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
onPrivateClear(() => {
  babies.value = []
  selectedId.value = ''
  clearImages()
})
