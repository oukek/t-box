import type { HolidayYearSnapshot } from '@t-box/calendar-contracts'
import {
  parseHolidayDataset,
} from '@t-box/calendar-contracts'
import { shallowRef } from 'vue'
import { calendarApi } from './api'
import { application } from './sdk'

interface CachedYear {
  fetchedAt: number
  snapshot: HolidayYearSnapshot
}
export const holidayYears = shallowRef<HolidayYearSnapshot[]>([])
const cache = new Map<number, CachedYear>()
function accept(value: unknown, year: number): CachedYear | null {
  const entry = value as CachedYear
  if (
    !entry ||
    !Number.isFinite(entry.fetchedAt) ||
    entry.snapshot?.year !== year ||
    entry.snapshot.region !== 'CN' ||
    !Number.isInteger(entry.snapshot.revision)
  ) {
    return null
  }
  try {
    if (entry.snapshot.data) {
      parseHolidayDataset(entry.snapshot.data, true)
    }
    return entry
  } catch {
    return null
  }
}
function update(entry: CachedYear) {
  cache.set(entry.snapshot.year, entry)
  holidayYears.value = [...cache.values()].map((v) => v.snapshot)
}
export async function loadHolidayYears(
  years: number[],
  signal: AbortSignal,
  refresh = false,
): Promise<boolean> {
  const results = await Promise.all(
    years
      .filter((year) => year >= 1900 && year <= 2100)
      .map(async (year) => {
        const key = `holiday-year-CN-${year}`
        if (!cache.has(year)) {
          try {
            const saved = accept(
              await application.client.storage.get(key),
              year,
            )
            if (saved && !signal.aborted) {
              update(saved)
            }
          } catch {
            /* Cache unavailable; network remains usable. */
          }
        }
        if (
          !refresh &&
          cache.has(year) &&
          Date.now() - cache.get(year)!.fetchedAt < 3600000
        ) {
          return true
        }
        try {
          const { data } = await calendarApi.holidayYear(year, signal)
          if (signal.aborted) {
            return true
          }
          const entry = accept({ fetchedAt: Date.now(), snapshot: data }, year)
          if (!entry) {
            throw new Error('节假日年度数据格式无效')
          }
          update(entry)
          try {
            await application.client.storage.set(key, entry)
          } catch {
            /* Retain the in-memory snapshot. */
          }
          return true
        } catch {
          return signal.aborted
        }
      }),
  )
  return results.every(Boolean)
}
