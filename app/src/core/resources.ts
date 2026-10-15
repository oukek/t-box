import type { Resource } from '@t-box/shared'
import { apiBase, request } from './network'
import { identity } from './session'

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
export async function resourceBlob(resource: Pick<Resource, 'id'>, signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }
  const timer = setTimeout(abort, 30000)
  try {
    const response = await fetch(`${apiBase}/resources/${encodeURIComponent(resource.id)}/content`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${identity.token}` },
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
