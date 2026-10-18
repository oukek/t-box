import type {
  ApplicationFile,
  ApplicationFileContent,
  FilePickOptions,
} from '@t-box/app-contracts'
import {
  APPLICATION_FILE_MAX_BYTES,
  APPLICATION_FILE_MAX_COUNT,
} from '@t-box/app-contracts'
import { SdkErrorCode } from '@t-box/app-sdk'
import { request } from '../network'

let choosing = false
/** Shared host picker: isolated apps never receive an OS file path or host login. */
export function chooseApplicationFiles(
  options: FilePickOptions,
  signal?: AbortSignal,
): Promise<File[]> {
  if (choosing) {
    throw SdkErrorCode.FILE_PICKER_BUSY()
  }
  if (
    Object.keys(options).some((key) => !['accept', 'multiple'].includes(key)) ||
    (options.accept !== undefined &&
      (typeof options.accept !== 'string' || options.accept.length > 500)) ||
      (options.multiple !== undefined && typeof options.multiple !== 'boolean')
  ) {
    throw SdkErrorCode.INVALID_ARGUMENTS('文件选择参数无效')
  }
  signal?.throwIfAborted()
  choosing = true
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = options.accept || ''
    input.multiple = options.multiple || false
    input.style.display = 'none'
    const cleanup = () => {
      choosing = false
      // eslint-disable-next-line ts/no-use-before-define -- Cleanup runs after both handlers are initialized.
      signal?.removeEventListener('abort', abort)
      input.remove()
    }
    const abort = () => {
      cleanup()
      reject(SdkErrorCode.REQUEST_CANCELLED('已取消文件选择'))
    }
    input.addEventListener(
      'change',
      () => {
        const files = Array.from(input.files || [])
        cleanup()
        if (
          files.length > APPLICATION_FILE_MAX_COUNT ||
          files.some(
            (file) => !file.size || file.size > APPLICATION_FILE_MAX_BYTES,
          )
        ) {
          reject(
            SdkErrorCode.FILE_SIZE(
              '每次最多 10 个文件，每个文件需为 1 字节至 10 MB',
            ),
          )
        } else {
          resolve(files)
        }
      },
      { once: true },
    )
    input.addEventListener(
      'cancel',
      () => {
        cleanup()
        resolve([])
      },
      { once: true },
    )
    signal?.addEventListener('abort', abort, { once: true })
    document.body.append(input)
    input.click()
  })
}
export async function uploadApplicationFile(
  appId: string,
  file: File,
  signal?: AbortSignal,
) {
  if (!file.size || file.size > APPLICATION_FILE_MAX_BYTES) {
    throw SdkErrorCode.FILE_SIZE()
  }
  return (
    await request<{ data: ApplicationFile }>(
      `/applications/${encodeURIComponent(appId)}/files`,
      {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        signal,
        timeoutMs: 60000,
      },
    )
  ).data
}
export async function readApplicationFile(
  appId: string,
  id: unknown,
  signal?: AbortSignal,
) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) {
    throw SdkErrorCode.INVALID_ARGUMENTS('文件标识无效')
  }
  return (
    await request<{ data: ApplicationFileContent }>(
      `/applications/${encodeURIComponent(appId)}/files/${encodeURIComponent(id)}`,
      { signal, timeoutMs: 60000 },
    )
  ).data
}
export function decodeApplicationFile(args: Record<string, unknown>) {
  if (
    Object.keys(args).some((key) => !['name', 'base64'].includes(key)) ||
    typeof args.name !== 'string' ||
    !args.name.trim() ||
    args.name.length > 200 ||
    typeof args.base64 !== 'string' ||
    args.base64.length > Math.ceil(APPLICATION_FILE_MAX_BYTES / 3) * 4 ||
    !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(
      args.base64,
    )
  ) {
    throw SdkErrorCode.INVALID_ARGUMENTS('文件参数无效')
  }
  const binary = atob(args.base64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new File([bytes], args.name, { type: 'application/octet-stream' })
}
