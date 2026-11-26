import type { ApplicationManifest } from '@t-box/app-contracts'
import { applicationIcon } from './icon.js'

export const manifest = {
  id: 'todo',
  name: '待办事项',
  description: '个人待办、循环清单、长期计划与生活统计',
  icon: 'task',
  iconAsset: applicationIcon,
  color: 'violet',
  version: '1.1.4',
  skillIds: [],
} as const satisfies ApplicationManifest
export * from './model.js'
