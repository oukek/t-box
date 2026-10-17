import type { Resource } from '@t-box/shared'
import { apiBase, request } from './network'
import { resourceUrl } from './resource-url'
import { identity } from './session'

let publicOrigin: Promise<string | null> | undefined
function resourceOrigin() {
  publicOrigin ??= fetch(`${apiBase}/resources/storage`, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error('读取文件存储地址失败')
    }
    return ((await response.json()) as { data: { origin: string | null } }).data.origin
  }).catch((error) => {
    publicOrigin = undefined
    throw error
  })
  return publicOrigin
}

/** Shared host resource port: credentials stay out of application rendering and image URLs. */
export async function uploadResource(file: File): Promise<Resource> {
  if (!file.size || file.size > 10 * 1024 * 1024) {
    throw new Error('每个文件需为 1 字节至 10 MB')
  }
  return (
    await request<{ data: Resource }>('/resources', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
      timeoutMs: 60000,
    })
  ).data
}
export async function resourceBlob(resource: Pick<Resource, 'id' | 'path'>, signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }
  const timer = setTimeout(abort, 30000)
  try {
    const file = resource.path ? resource : (await request<{ data: Resource }>(`/resources/${encodeURIComponent(resource.id)}`, { signal: controller.signal })).data
    const origin = file.path?.includes('/') ? await resourceOrigin() : null
    const url = origin && file.path ? resourceUrl(origin, file.path) : null
    const response = await fetch(url || `${apiBase}/resources/${encodeURIComponent(resource.id)}/content`, {
      signal: controller.signal,
      headers: url ? {} : { Authorization: `Bearer ${identity.token}` },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(response.status === 404 ? '文件已删除或不可访问' : '文件加载失败')
    }
    return await response.blob()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
