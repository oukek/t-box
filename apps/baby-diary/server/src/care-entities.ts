import type { CareKind, CareState, FeedingPart } from '@t-box/baby-diary-contracts/care'
import { EntitySchema } from 'typeorm'

export interface StoredCare {
  id: string
  babyId: string
  kind: CareKind
  occurredAt: Date
  endedAt: Date | null
  state: CareState
  activeSlot: CareKind | null
  note: string
  author: string
  authorName: string
  revision: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}
export const BabyCareEntity = new EntitySchema<StoredCare>({
  name: 'BabyCare',
  tableName: 'baby_diary_care',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    babyId: { type: 'char', name: 'baby_id', length: 36 },
    kind: { type: 'varchar', length: 12 },
    occurredAt: { type: 'datetime', precision: 3, name: 'occurred_at' },
    endedAt: { type: 'datetime', precision: 3, name: 'ended_at', nullable: true },
    state: { type: 'varchar', length: 12 },
    activeSlot: { type: 'varchar', length: 12, name: 'active_slot', nullable: true },
    note: { type: 'varchar', length: 500 },
    author: { type: 'char', length: 64 },
    authorName: { type: 'varchar', length: 40, name: 'author_name' },
    revision: { type: 'int' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
    deletedAt: { type: 'datetime', precision: 3, name: 'deleted_at', nullable: true },
  },
  indices: [
    { name: 'baby_care_timeline', columns: ['babyId', 'deletedAt', 'occurredAt'] },
    { name: 'baby_care_active', columns: ['babyId', 'activeSlot'], unique: true },
  ],
})
export const BabyFeedingEntity = new EntitySchema<{ eventId: string, parts: FeedingPart[] }>({
  name: 'BabyFeeding',
  tableName: 'baby_diary_feedings',
  columns: {
    eventId: { type: 'char', length: 36, primary: true, name: 'event_id' },
    parts: { type: 'json' },
  },
})
export const BabyDiaperEntity = new EntitySchema<{ eventId: string, contents: 'wet' | 'dirty' | 'both' | 'change' }>({
  name: 'BabyDiaper',
  tableName: 'baby_diary_diapers',
  columns: {
    eventId: { type: 'char', length: 36, primary: true, name: 'event_id' },
    contents: { type: 'varchar', length: 12 },
  },
})
export const BabyCareRevisionEntity = new EntitySchema<{ eventId: string, revision: number, actor: string, snapshot: unknown, createdAt: Date }>({
  name: 'BabyCareRevision',
  tableName: 'baby_diary_care_revisions',
  columns: {
    eventId: { type: 'char', length: 36, primary: true, name: 'event_id' },
    revision: { type: 'int', primary: true },
    actor: { type: 'char', length: 64 },
    snapshot: { type: 'json' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
})
export const babyCareEntities = [BabyCareEntity, BabyFeedingEntity, BabyDiaperEntity, BabyCareRevisionEntity]
