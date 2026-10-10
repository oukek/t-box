import type { HolidayDataset } from '@t-box/calendar-contracts'
import {
  parseHolidayDataset,
} from '@t-box/calendar-contracts'
import { ApiError } from '@t-box/server-foundation/errors'

export const holidayProvider = 'https://github.com/NateScarlet/holiday-cn'
export type HolidayFetcher = (
  year: number,
  signal: AbortSignal,
) => Promise<HolidayDataset | null>
const download = async (
  year: number,
  signal: AbortSignal,
  url: string,
): Promise<HolidayDataset | null> => {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
    redirect: 'error',
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ApiError(
      502,
      'HOLIDAY_SOURCE_FAILED',
      `节假日数据源返回 ${response.status}`,
    )
  }
  const reader = response.body!.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      size += next.value.byteLength
      if (size > 65536) {
        throw new Error('节假日数据超过大小限制')
      }
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel()
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (
    value.year !== year ||
    !Array.isArray(value.papers) ||
    !Array.isArray(value.days)
  ) {
    throw new Error('节假日数据源格式无效')
  }
  if (!value.papers.length && !value.days.length) {
    return null
  } // Upcoming-year placeholder is not a published schedule.
  return parseHolidayDataset(
    {
      year,
      papers: value.papers,
      days: value.days.map((day: Record<string, unknown>) => {
        if (typeof day.isOffDay !== 'boolean') {
          // eslint-disable-next-line unicorn/prefer-type-error -- Preserve the provider's existing Error contract during this style migration.
          throw new Error('节假日休班标记无效')
        }
        return {
          name: day.name,
          date: day.date,
          status: day.isOffDay ? 'rest' : 'work',
        }
      }),
    },
    true,
  )
}

export const fetchHolidayYear: HolidayFetcher = async (year, signal) => {
  let failure: unknown
  for (const url of [
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
  ]) {
    try {
      return await download(year, signal, url)
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      failure = error
    }
  }
  throw failure
}
