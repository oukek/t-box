import { hostBrand } from '@t-box/app-contracts'

/** Version is injected from app/package.json in development and production builds. */
export const appInfo = {
  ...hostBrand,
  version: __APP_VERSION__,
  description: '一个入口，连接对话与日常工具。',
} as const
