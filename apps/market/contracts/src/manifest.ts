import type { ApplicationManifest } from '@t-box/app-contracts'
import { applicationIcon } from './icon.js'

export const marketManifest: ApplicationManifest = {
  id: 'market',
  name: '应用市场',
  description: '发现、安装与管理应用',
  icon: 'apps',
  iconAsset: applicationIcon,
  color: 'blue',
  version: '1.1.0',
  skillIds: [],
}
