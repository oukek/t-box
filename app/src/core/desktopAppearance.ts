import type {
  DesktopAppearanceSnapshot,
  DesktopAppearanceState,
  DesktopWallpapers,
  WallpaperSource,
} from '@t-box/app-contracts'
import { defaultDesktopWallpapers } from '@t-box/app-contracts'
import { reactive, readonly, watch } from 'vue'
import { ErrorCode } from '../error-codes.js'
import { request, RequestError } from './network'
import { resourceBlob, uploadResource } from './resources'
import { identity } from './session'

const state = reactive<DesktopAppearanceState>({
  revision: 0,
  wallpapers: defaultDesktopWallpapers(),
  imageUrls: {},
  loading: false,
  saving: false,
  error: '',
})
export const desktopAppearance = readonly(state)
let generation = 0
let controller = new AbortController()
let pending: Promise<void> | undefined
const cacheKey = (id: string) => `tbox.desktop-appearance.v1:${id}`
function cache(id: string) {
  try {
    localStorage.setItem(
      cacheKey(id),
      JSON.stringify({
        revision: state.revision,
        wallpapers: state.wallpapers,
      }),
    )
  } catch {
    /* Server persistence remains authoritative when browser storage is unavailable. */
  }
}
function assertSession(id: string, token: string, epoch: number) {
  if (
    identity.user?.id !== id ||
    identity.token !== token ||
    generation !== epoch
  ) {
    throw ErrorCode.INTERNAL_SESSION_CHANGED()
  }
}
async function loadImage(source: WallpaperSource, epoch: number) {
  if (source.kind !== 'resource' || state.imageUrls[source.resourceId]) {
    return
  }
  const blob = await resourceBlob({ id: source.resourceId }, controller.signal)
  if (generation === epoch && !controller.signal.aborted) {
    state.imageUrls[source.resourceId] = URL.createObjectURL(blob)
  }
}
async function images(epoch: number) {
  const sources = [
    ...new Map(
      Object.values(state.wallpapers)
        .filter(
          (source): source is WallpaperSource => source?.kind === 'resource',
        )
        .map((source) => [
          source.kind === 'resource' ? source.resourceId : '',
          source,
        ]),
    ).values(),
  ]
  await Promise.allSettled(sources.map((source) => loadImage(source, epoch)))
}
export function releaseWallpaperPreviews() {
  const used = new Set(
    Object.values(state.wallpapers).flatMap((source) =>
      source?.kind === 'resource' ? [source.resourceId] : [],
    ),
  )
  for (const [id, url] of Object.entries(state.imageUrls)) {
    if (!used.has(id)) {
      URL.revokeObjectURL(url)
      delete state.imageUrls[id]
    }
  }
}
export async function refreshDesktopAppearance() {
  if (pending) {
    return pending
  }
  const id = identity.user?.id
  const token = identity.token
  if (!id || !token) {
    return
  }
  const epoch = generation
  state.loading = true
  state.error = ''
  const work = (async () => {
    try {
      const result = (
        await request<{ data: DesktopAppearanceSnapshot }>(
          '/desktop/appearance',
          { signal: controller.signal },
        )
      ).data
      assertSession(id, token, epoch)
      state.wallpapers = result.wallpapers
      state.revision = result.revision
      cache(id)
      await images(epoch)
      if (generation === epoch) {
        releaseWallpaperPreviews()
      }
    } catch (error) {
      if (generation === epoch) {
        state.error =
          error instanceof Error ? error.message : '壁纸设置加载失败'
      }
    } finally {
      if (generation === epoch) {
        state.loading = false
        pending = undefined
      }
    }
  })()
  pending = work
  return work
}
export async function saveDesktopWallpapers(wallpapers: DesktopWallpapers) {
  if (state.saving || state.loading || state.error) {
    throw ErrorCode.INTERNAL_WALLPAPER_SYNC_BUSY(
      state.error || '正在同步壁纸设置，请稍后再试',
    )
  }
  const id = identity.user?.id
  const token = identity.token
  const epoch = generation
  if (!id || !token) {
    throw ErrorCode.INTERNAL_LOGIN_REQUIRED()
  }
  state.saving = true
  try {
    const result = (
      await request<{ data: DesktopAppearanceSnapshot }>(
        '/desktop/appearance',
        {
          method: 'PUT',
          signal: controller.signal,
          body: JSON.stringify({ revision: state.revision, wallpapers }),
        },
      )
    ).data
    assertSession(id, token, epoch)
    state.wallpapers = result.wallpapers
    state.revision = result.revision
    cache(id)
    await images(epoch)
    if (generation === epoch) {
      releaseWallpaperPreviews()
    }
  } catch (error) {
    if (
      generation === epoch &&
      error instanceof RequestError &&
      error.code === 'DESKTOP_APPEARANCE_CHANGED'
    ) {
      await refreshDesktopAppearance()
    }
    throw error
  } finally {
    if (generation === epoch) {
      state.saving = false
    }
  }
}
export async function uploadDesktopWallpaper(
  file: File,
): Promise<WallpaperSource> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  ) {
    throw ErrorCode.INTERNAL_INVALID_WALLPAPER_IMAGE()
  }
  const id = identity.user?.id
  const token = identity.token
  const epoch = generation
  if (!id || !token) {
    throw ErrorCode.INTERNAL_LOGIN_REQUIRED()
  }
  const preview = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = preview
    await image.decode().catch(() => {
      throw ErrorCode.INTERNAL_INVALID_IMAGE_FILE()
    })
    if (image.naturalWidth * image.naturalHeight > 40000000) {
      throw ErrorCode.INTERNAL_IMAGE_DIMENSION_LIMIT()
    }
    assertSession(id, token, epoch)
    const resource = await uploadResource(file)
    assertSession(id, token, epoch)
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(resource.mimeType)
    ) {
      throw ErrorCode.INTERNAL_UNSUPPORTED_IMAGE_FORMAT()
    }
    const source: WallpaperSource = {
      kind: 'resource',
      resourceId: resource.id,
    }
    await loadImage(source, epoch)
    return source
  } finally {
    URL.revokeObjectURL(preview)
  }
}

watch(
  () => [identity.user?.id, identity.token],
  () => {
    generation++
    controller.abort()
    controller = new AbortController()
    pending = undefined
    for (const url of Object.values(state.imageUrls)) {
      URL.revokeObjectURL(url)
    }
    Object.assign(state, {
      revision: 0,
      wallpapers: defaultDesktopWallpapers(),
      loading: false,
      saving: false,
      error: '',
      imageUrls: {},
    })
    const id = identity.user?.id
    if (!id) {
      return
    }
    // Only built-in choices are used optimistically. Private image bytes always require authentication.
    try {
      const cached: DesktopAppearanceSnapshot | null = JSON.parse(
        localStorage.getItem(cacheKey(id)) || 'null',
      )
      if (cached?.wallpapers?.common?.kind === 'builtin') {
        state.wallpapers.common = cached.wallpapers.common
      }
    } catch {
      /* Ignore invalid local cache. */
    }
    void refreshDesktopAppearance()
  },
  { immediate: true },
)
