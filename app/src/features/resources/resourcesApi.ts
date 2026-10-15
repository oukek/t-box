import type { Resource } from '@t-box/shared'
import { resourceBlob } from '../../core/resources'

export { resourceBlob, uploadResource } from '../../core/resources'
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
