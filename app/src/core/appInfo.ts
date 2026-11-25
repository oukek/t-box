import { hostBrand } from '@t-box/app-contracts'

/** Release builds receive the reserved UI version; local builds use the package version. */
export const appInfo = {
  ...hostBrand,
  version: __APP_VERSION__,
  description: '一个入口，连接对话与日常工具。',
} as const
