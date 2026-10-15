export function verifiedOffline(): {
  name: string
  apply: 'build'
  enforce: 'post'
  configResolved: (config: { root: string, build: { outDir: string } }) => void
  transformIndexHtml: () => { tag: string, attrs: { type: string, src: string }, injectTo: 'body' }[]
  closeBundle: () => Promise<void>
}
