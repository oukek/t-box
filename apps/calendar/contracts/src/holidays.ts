import { DateTimeError, validDate } from '@t-box/time-contracts'

export interface HolidayArrangement {
  name: string
  status: 'rest' | 'work'
  source: string
}
export interface HolidayDay {
  date: string
  name: string
  status: 'rest' | 'work'
}
export interface HolidayDataset {
  year: number
  papers: string[]
  days: HolidayDay[]
}
export interface HolidayYearSnapshot {
  region: 'CN'
  year: number
  revision: number
  publishedAt: string | null
  data: HolidayDataset | null
}
export interface HolidayYearAdmin extends HolidayYearSnapshot {
  candidate: HolidayDataset | null
  manual: boolean
  checkedAt: string | null
  lastError: string | null
  updatedBy: string | null
}
export interface HolidaySyncSettings {
  enabled: boolean
  autoPublish: boolean
}
export function holidayYear(value: unknown): number {
  const year =
    typeof value === 'string' && /^\d{4}$/.test(value) ? Number(value) : value
  if (!Number.isInteger(year) || Number(year) < 1900 || Number(year) > 2100) {
    throw new DateTimeError('节假日年度范围为 1900–2100 年')
  }
  return Number(year)
}
export function parseHolidayDataset(
  value: unknown,
  complete = false,
): HolidayDataset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DateTimeError('节假日数据格式无效')
  }
  const v = value as Record<string, unknown>
  const year = holidayYear(v.year)
  if (
    Object.keys(v).some((key) => !['year', 'papers', 'days'].includes(key)) ||
    !Array.isArray(v.papers) ||
    !v.papers.length ||
    v.papers.length > 20 ||
    !Array.isArray(v.days) ||
    v.days.length > 120
  ) {
    throw new DateTimeError('请提供年度、官方原文链接和日期列表')
  }
  const papers = v.papers.map((link) => {
    if (typeof link !== 'string' || link.length > 2048) {
      throw new DateTimeError('官方来源链接无效')
    }
    let url: URL
    try {
      url = new URL(link)
    } catch {
      throw new DateTimeError('官方来源链接无效')
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !(url.hostname === 'gov.cn' || url.hostname.endsWith('.gov.cn')) ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new DateTimeError('来源须为中国政府网站的公告链接')
    }
    return link
  })
  const days = v.days
    .map((raw): HolidayDay => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new DateTimeError('日期记录格式无效')
      }
      const d = raw as Record<string, unknown>
      const date = validDate(d.date)
      if (
        Object.keys(d).some(
          (key) => !['date', 'name', 'status'].includes(key),
        ) ||
        typeof d.name !== 'string' ||
        !d.name.trim() ||
        d.name.length > 50 ||
        !['rest', 'work'].includes(String(d.status)) ||
        date < `${year - 1}-12-01` ||
        date > `${year + 1}-01-31`
      ) {
        throw new DateTimeError('日期、节日名称或休班类型无效')
      }
      return {
        date,
        name: d.name.trim(),
        status: d.status as HolidayDay['status'],
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  if (new Set(days.map((d) => d.date)).size !== days.length) {
    throw new DateTimeError('同一日期不能重复')
  }
  if (
    complete &&
    (!days.length ||
      ['元旦', '春节', '清明', '劳动', '端午', '中秋', '国庆'].some(
        (name) =>
          !days.some((d) => d.status === 'rest' && d.name.includes(name)),
      ))
  ) {
    throw new DateTimeError('年度安排尚不完整，需覆盖七类主要节假日')
  }
  return { year, papers: [...new Set(papers)], days }
}
export function holidayArrangement(
  date: string,
  years: readonly HolidayYearSnapshot[] = [],
): HolidayArrangement | null {
  // Next-year notices may modify dates in December of the previous year.
  for (const year of [...years].sort((a, b) => b.year - a.year)) {
    const day = year.data?.days.find((d) => d.date === date)
    if (day) {
      return {
        name: day.name,
        status: day.status,
        source: year.data!.papers[0]!,
      }
    }
  }
  return null
}
export function holidayScheduleKnown(
  year: number,
  years: readonly HolidayYearSnapshot[] = [],
): boolean {
  return years.some((y) => y.year === year && y.data !== null)
}
