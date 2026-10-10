import { EntitySchema } from 'typeorm'

export interface ApplicationOperation {
  userId: string
  appId: string
  operationKey: string
  payloadHash: string
  response: unknown
  createdAt: Date
}
export const ApplicationOperationEntity =
  new EntitySchema<ApplicationOperation>({
    name: 'ApplicationOperation',
    tableName: 'application_operations',
    columns: {
      userId: { type: 'char', length: 36, name: 'user_id', primary: true },
      appId: { type: 'varchar', length: 40, name: 'app_id', primary: true },
      operationKey: {
        type: 'char',
        length: 64,
        name: 'operation_key',
        primary: true,
      },
      payloadHash: { type: 'char', length: 64, name: 'payload_hash' },
      response: { type: 'json' },
      createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    },
  })
