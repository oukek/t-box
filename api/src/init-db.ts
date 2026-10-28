import { createConnection } from 'mysql2/promise'
import { getConfig } from './config.js'
import { createDataSource } from './db/data-source.js'
import { initializeDatabase } from './db/initialize.js'
import { databaseSchemas } from './db/schema/index.js'
import { ErrorCode } from './error-codes.js'

async function main() {
  const checkOnly = process.argv.includes('--check')
  if (process.argv.slice(2).some((arg) => arg !== '--check')) {
    throw ErrorCode.INTERNAL_INVALID_INITIALIZATION_ARGUMENTS()
  }
  const { database, ...options } = getConfig().mysql
  const connection = await createConnection(options)
  try {
    if (checkOnly) {
      const [schemas] = await connection.query(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
        [database],
      )
      if (!(schemas as unknown[]).length) {
        console.info(
          'Database initialization preflight passed: a fresh database will be created.',
        )
        return
      }
    } else {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      )
    }
  } finally {
    await connection.end()
  }
  const source = await createDataSource().initialize()
  try {
    const result = await initializeDatabase(source, databaseSchemas, {
      checkOnly,
    })
    console.info(
      checkOnly
        ? `Database initialization preflight passed: baseline ${result.baseline}. No data changed.`
        : result.initialized
          ? `Database initialized: ${result.tables} tables, baseline ${result.baseline}.`
          : `Database ready: baseline ${result.baseline}, ${result.upgraded ?? 0} extensions applied.`,
    )
  } finally {
    await source.destroy()
  }
}
await main()
