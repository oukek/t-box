import type { ApplicationModule } from '@t-box/app-server-sdk'
import { manifest } from '@t-box/shop-tools-contracts'

export { ShopCatalog } from './catalog.js'
export type { CreativeModel } from './creative.js'
export function createShopToolsModule(): ApplicationModule {
  return {
    id: 'shop-tools',
    contractVersion: '1.0',
    manifest,
    skills: {},
    tools: {},
    interactions: [],
    navigation: { properties: {}, parse: () => ({}) },
  }
}

export { createDataService } from './data.js'
export { shopToolsEntities } from './entities.js'
export { applicationRelease } from './release.js'

export { shopToolsSchema } from './schema.js'

export { ShopToolsService } from './workspace.js'
