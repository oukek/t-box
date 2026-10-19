export function workspaceSources(options?: { root?: string }): {
  name: string
  enforce: 'pre'
  config: () => { resolve: { dedupe: string[] }, optimizeDeps: { exclude: string[] } }
  resolveId: (id: string, importer?: string) => string | null
  configureServer: (server: {
    watcher: { add: (paths: string[]) => unknown, on: (event: string, listener: (event: string, path: string) => void) => unknown, off: (event: string, listener: (event: string, path: string) => void) => unknown }
    restart: () => Promise<unknown>
    config: { logger: { error: (message: string) => void } }
  }) => void
  closeBundle: () => void
}
