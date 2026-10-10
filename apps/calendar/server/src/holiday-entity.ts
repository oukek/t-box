import type { HolidayDataset } from '@t-box/calendar-contracts'
import { EntitySchema } from 'typeorm'

export interface HolidayYearRow {
  region: 'CN'
  year: number
  published: HolidayDataset | null
  candidate: HolidayDataset | null
  revision: number
  manual: boolean
  checkedAt: Date | null
  lastError: string | null
  publishedAt: Date | null
  updatedAt: Date
  updatedBy: string | null
}
export const HolidayYearEntity = new EntitySchema<HolidayYearRow>({
  name: 'CalendarHolidayYear',
  tableName: 'calendar_holiday_years',
  columns: {
    region: { type: 'varchar', length: 8, primary: true },
    year: { type: Number, primary: true },
    published: { type: 'json', nullable: true },
    candidate: { type: 'json', nullable: true },
    revision: { type: Number },
    manual: { type: Boolean, name: 'manual_override' },
    checkedAt: {
      type: 'datetime',
      precision: 3,
      name: 'checked_at',
      nullable: true,
    },
    lastError: {
      type: 'varchar',
      length: 400,
      name: 'last_error',
      nullable: true,
    },
    publishedAt: {
      type: 'datetime',
      precision: 3,
      name: 'published_at',
      nullable: true,
    },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
    updatedBy: {
      type: 'varchar',
      length: 36,
      name: 'updated_by',
      nullable: true,
    },
  },
})
export interface HolidaySettingsRow {
  region: 'CN'
  enabled: boolean
  autoPublish: boolean
}
export const HolidaySettingsEntity = new EntitySchema<HolidaySettingsRow>({
  name: 'CalendarHolidaySettings',
  tableName: 'calendar_holiday_settings',
  columns: {
    region: { type: 'varchar', length: 8, primary: true },
    enabled: { type: Boolean },
    autoPublish: { type: Boolean, name: 'auto_publish' },
  },
})
export interface HolidayAuditRow {
  id: string
  year: number
  action: string
  actorId: string | null
  revision: number
  data: unknown
  createdAt: Date
}
export const HolidayAuditEntity = new EntitySchema<HolidayAuditRow>({
  name: 'CalendarHolidayAudit',
  tableName: 'calendar_holiday_audit',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    year: { type: Number },
    action: { type: 'varchar', length: 30 },
    actorId: { type: 'varchar', length: 36, name: 'actor_id', nullable: true },
    revision: { type: Number },
    data: { type: 'json' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
})
