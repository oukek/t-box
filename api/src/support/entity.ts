import { EntitySchema } from 'typeorm'

export interface SupportSettingsRow {
  id: number
  enabled: boolean
  qrCodeUrl: string
  updatedAt: Date | null
  updatedBy: string | null
}

export const SupportSettingsEntity = new EntitySchema<SupportSettingsRow>({
  name: 'SupportSettings',
  tableName: 'support_settings',
  columns: {
    id: { type: 'tinyint', primary: true },
    enabled: { type: Boolean, default: false },
    qrCodeUrl: {
      type: 'varchar',
      length: 2048,
      name: 'qr_code_url',
      default: '',
    },
    updatedAt: { type: 'datetime', name: 'updated_at', nullable: true },
    updatedBy: { type: 'char', length: 36, name: 'updated_by', nullable: true },
  },
  checks: [{ name: 'single_support_settings', expression: 'id = 1' }],
})
