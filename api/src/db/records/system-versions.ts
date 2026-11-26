import { EntitySchema } from 'typeorm'

export const SystemVersionCursor = new EntitySchema<{ id: number, ui: string, core: string }>({
  name: 'SystemVersionCursor',
  tableName: 'system_version_cursor',
  columns: {
    id: { type: 'tinyint', unsigned: true, primary: true },
    ui: { type: 'varchar', length: 96 },
    core: { type: 'varchar', length: 96 },
  },
})

interface Reservation {
  batch: string
  request_hash: string
  build: string
  ui: string | null
  core: string | null
}

export const SystemVersionReservation = new EntitySchema<Reservation>({
  name: 'SystemVersionReservation',
  tableName: 'system_version_reservations',
  columns: {
    batch: { type: 'varchar', length: 160, primary: true },
    request_hash: { type: 'char', length: 64 },
    build: { type: 'char', length: 36, unique: true },
    ui: { type: 'varchar', length: 96, nullable: true, unique: true },
    core: { type: 'varchar', length: 96, nullable: true, unique: true },
  },
})

export interface WebCandidate {
  build: string
  version: string
  digest: string
  state: 'pending' | 'publishing' | 'failed' | 'live' | 'archived'
  files: number
  bytes: number
  createdAt: Date
  actor: string | null
}
export const SystemWebCandidate = new EntitySchema<WebCandidate>({
  name: 'SystemWebCandidate',
  tableName: 'system_web_candidates',
  columns: {
    build: { type: 'char', length: 36, primary: true },
    version: { type: 'varchar', length: 96, unique: true },
    digest: { type: 'char', length: 64 },
    state: { type: 'varchar', length: 16 },
    files: { type: 'int', unsigned: true },
    bytes: { type: 'int', unsigned: true },
    createdAt: { name: 'created_at', type: 'datetime', precision: 3, createDate: true },
    actor: { type: 'varchar', length: 64, nullable: true },
  },
})

export interface DesktopArtifact {
  bytes?: number
  build: string
  version: string
  digest: string
  signature: string
}
export interface DesktopCandidate {
  build: string
  base: string | null
  kind: 'ui' | 'core' | 'both'
  ui: DesktopArtifact
  core: DesktopArtifact
  notes: string
  state: 'pending' | 'live' | 'archived'
  createdAt: Date
  actor: string | null
}
export const SystemDesktopCandidate = new EntitySchema<DesktopCandidate>({
  name: 'SystemDesktopCandidate',
  tableName: 'system_desktop_candidates',
  columns: {
    build: { type: 'char', length: 36, primary: true },
    base: { type: 'char', length: 36, nullable: true },
    kind: { type: 'varchar', length: 8 },
    ui: { type: 'json' },
    core: { type: 'json' },
    notes: { type: 'varchar', length: 1000 },
    state: { type: 'varchar', length: 16 },
    createdAt: { name: 'created_at', type: 'datetime', precision: 3, createDate: true },
    actor: { type: 'varchar', length: 64, nullable: true },
  },
})

export const SystemWebReleaseNotes = new EntitySchema<{ build: string, notes: string }>({
  name: 'SystemWebReleaseNotes',
  tableName: 'system_web_release_notes',
  columns: {
    build: { type: 'char', length: 36, primary: true },
    notes: { type: 'text' },
  },
})
