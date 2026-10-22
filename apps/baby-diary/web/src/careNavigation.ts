import { dayjs } from '@t-box/dayjs'

export type CareNavigation = 'auto' | 'pinned' | 'menu'
export const careNavigationOptions = [
  { value: 'auto', label: '随年龄调整', description: '2 岁前显示在导航中，之后收至档案菜单' },
  { value: 'pinned', label: '始终显示', description: '在成长、创意旁保留照护入口' },
  { value: 'menu', label: '收至档案菜单', description: '需要时从宝宝档案打开照护与历史统计' },
]
export const readCareNavigation = (value: unknown): CareNavigation =>
  value === 'pinned' || value === 'menu' ? value : 'auto'

/** Presentation only. Age never revokes record access or changes family permissions. */
export function showCareNavigation(mode: CareNavigation, birthDate: string | null, today: string) {
  if (mode !== 'auto') {
    return mode === 'pinned'
  }
  if (!birthDate) {
    return false
  }
  return birthDate <= today && today < dayjs.utc(birthDate).add(2, 'year').format('YYYY-MM-DD')
}
