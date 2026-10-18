import { createConnection } from 'mysql2/promise'
import { getConfig } from './config.js'
import { createDataSource } from './db/data-source.js'
import { initializeDatabase } from './db/initialize.js'
import { databaseSchemas } from './db/schema/index.js'

const { database, ...options } = getConfig().mysql
const connection = await createConnection(options)
try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  )
} finally {
  await connection.end()
}
const source = await createDataSource().initialize()
try {
  const result = await initializeDatabase(source, databaseSchemas)
  console.info(
    result.initialized
      ? `Database initialized: ${result.tables} tables, baseline ${result.baseline}.`
      : `Database already initialized: baseline ${result.baseline}. No data or configuration changed.`,
  )
} finally {
  await source.destroy()
}
