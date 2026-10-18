import { DataSource } from 'typeorm'
import { getConfig } from '../config.js'
import { entities } from './entities.js'
import 'reflect-metadata'

export function createDataSource(config = getConfig().mysql) {
  const { user, ...options } = config
  return new DataSource({
    type: 'mysql',
    ...options,
    username: user,
    charset: 'utf8mb4_unicode_ci',
    supportBigNumbers: true,
    bigNumberStrings: true,
    entities,
    synchronize: false,
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
    logging: false,
    extra: { connectionLimit: 10, waitForConnections: true, queueLimit: 100 },
  })
}
