import type { CalendarEventInput } from '@t-box/calendar-contracts'
import { EntitySchema } from 'typeorm'

export interface StoredCalendarEvent {
  id: string
  userId: string
  title: string
  data: CalendarEventInput
  revision: number
  deleted: boolean
  createdAt: Date
  updatedAt: Date
}
export const CalendarEventEntity = new EntitySchema<StoredCalendarEvent>({
  name: 'CalendarEvent',
  tableName: 'calendar_events',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    userId: { type: 'char', length: 36, name: 'user_id' },
    title: { type: 'varchar', length: 100 },
    data: { type: 'json' },
    revision: { type: Number },
    deleted: { type: Boolean },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
  },
})
export interface StoredCalendarException {
  eventId: string
  date: string
  state: 'skipped' | 'completed'
}
export const CalendarExceptionEntity =
  new EntitySchema<StoredCalendarException>({
    name: 'CalendarException',
    tableName: 'calendar_exceptions',
    columns: {
      eventId: { type: 'char', length: 36, name: 'event_id', primary: true },
      date: { type: 'date', primary: true },
      state: { type: 'varchar', length: 20 },
    },
  })
