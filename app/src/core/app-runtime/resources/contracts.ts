export interface ApplicationPackage {
  appId: string
  releaseId: string
  entryUrl: string
  digest: string
}
export interface ResourceProgress { completed: number, total: number, bytes: number }
export interface ResourceLocation { entryUrl: string, origin: string, source: 'local' | 'network' | 'development' }
export interface ResourceAdapter {
  prepare(pkg: ApplicationPackage, progress?: (value: ResourceProgress) => void): Promise<'ready' | 'unsupported'>
  open(pkg: ApplicationPackage): Promise<ResourceLocation>
  remove(pkg: ApplicationPackage): Promise<void>
}
export interface ResourceJournal {
  prepared: ApplicationPackage[]
  healthy: Record<string, { current: ApplicationPackage, previous?: ApplicationPackage }>
  quarantined: string[]
}
export interface JournalStorage { read(): ResourceJournal | undefined, write(value: ResourceJournal): void }
