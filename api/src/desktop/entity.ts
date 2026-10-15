import type { DesktopWallpapers } from '@t-box/app-contracts'
import type { DesktopDevice } from '@t-box/shared'
import { EntitySchema } from 'typeorm'

interface StoredDesktopLayout {
  userId: string
  device: DesktopDevice
  appIds: string[]
  revision: number
  updatedAt: Date
}
export const DesktopLayoutEntity = new EntitySchema<StoredDesktopLayout>({
  name: 'DesktopLayout',
  tableName: 'user_desktop_layouts',
  columns: {
    userId: { type: 'char', length: 36, primary: true, name: 'user_id' },
    device: { type: 'varchar', length: 12, primary: true },
    appIds: { type: 'json', name: 'app_ids' },
    revision: { type: 'int', unsigned: true, default: 1 },
    updatedAt: {
      type: 'datetime',
      precision: 3,
      name: 'updated_at',
      default: () => 'CURRENT_TIMESTAMP(3)',
    },
  },
})

export const DesktopAppearanceEntity = new EntitySchema<{
  userId: string
  wallpapers: DesktopWallpapers
  revision: number
  updatedAt: Date
}>({
  name: 'DesktopAppearance',
  tableName: 'user_desktop_appearance',
  columns: {
    userId: { type: 'char', length: 36, primary: true, name: 'user_id' },
    wallpapers: { type: 'json' },
    revision: { type: 'int', unsigned: true, default: 1 },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at', default: () => 'CURRENT_TIMESTAMP(3)' },
  },
})
