/** App-visible file metadata; contains no host credentials, filesystem path or public URL. */
export interface ApplicationFile {
  id: string
  name: string
  mimeType: string
  size: number
  source: 'uploaded' | 'generated'
  createdAt: string
}
export interface ApplicationFileContent {
  file: ApplicationFile
  base64: string
}
export interface FilePickOptions {
  accept?: string
  multiple?: boolean
}
export const APPLICATION_FILE_MAX_BYTES = 10 * 1024 * 1024
export const APPLICATION_FILE_MAX_COUNT = 10
