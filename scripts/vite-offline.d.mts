export function verifiedOffline(options?: { application?: boolean, shellRelease?: string, uiVersion?: string }): {
  name: string
  apply: 'build'
  enforce: 'post'
  configResolved: (config: { root: string, build: { outDir: string } }) => void
  transformIndexHtml: () => { tag: string, attrs: Record<string, string>, injectTo: 'body' | 'head-prepend' }[]
  closeBundle: () => Promise<void>
}
