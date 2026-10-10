import { createConnection } from 'mysql2/promise'
import { getConfig } from './config.js'
import { createDataSource } from './db/data-source.js'

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
const lock = source.createQueryRunner()
try {
  await lock.connect()
  const acquired = await lock.query(
    'SELECT GET_LOCK(\'tbox_schema_migrations\',30) AS acquired',
  )
  if (!acquired[0]?.acquired) {
    throw new Error('Unable to lock database migrations')
  }
  const migrations = await source.runMigrations({ transaction: 'none' })
  console.info(
    `Database ready: ${migrations.length} migration(s) applied. Existing data preserved.`,
  )
} finally {
  await lock.query('SELECT RELEASE_LOCK(\'tbox_schema_migrations\')')
  await lock.release()
  await source.destroy()
}
