import type { Resource } from '@t-box/shared'
import { apiBase, request } from '../../core/network'
import { identity } from '../../core/session'

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
    })
  ).data
}
export async function resourceBlob(resource: Resource, signal?: AbortSignal) {
  const response = await fetch(`${apiBase}/resources/${resource.id}/content`, {
    signal,
    headers: { Authorization: `Bearer ${identity.token}` },
  })
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? '文件已删除或不可访问' : '文件加载失败',
    )
  }
  return response.blob()
}
export async function downloadResource(resource: Resource) {
  const url = URL.createObjectURL(await resourceBlob(resource))
  const a = document.createElement('a')
  a.href = url
  a.download = resource.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const fileSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`
