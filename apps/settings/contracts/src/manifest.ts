import type { ApplicationManifest } from '@t-box/app-contracts'
import { applicationIcon } from './icon.js'

export const profileManifest: ApplicationManifest = {
  id: 'profile',
  name: '我的',
  description: '账号、资源与个人设置',
  icon: 'user',
  iconAsset: applicationIcon,
  color: 'violet',
  version: '1.1.0',
  skillIds: [],
}
