import type { DataSource } from 'typeorm'
import type { OssResourceStorage } from './oss.js'
import type { LocalResourceStorage } from './storage.js'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Copy and verify first, commit the new location, then remove only the proven local object. */
export async function migrateLocalResources(source: DataSource, local: LocalResourceStorage, remote: OssResourceStorage, backend: string) {
  let migrated = 0
  let purged = 0
  const resources = await source.query('SELECT id,name,mime_type AS mimeType,object_path AS path,deleted_at FROM resources WHERE storage_backend=\'local\'')
  for (const row of resources) {
    if (row.deleted_at) {
      await local.remove(row.path)
      await source.query('UPDATE resources SET purged_at=COALESCE(purged_at,UTC_TIMESTAMP(3)) WHERE id=? AND storage_backend=\'local\' AND deleted_at IS NOT NULL', [row.id])
      purged++
      continue
    }
    const bytes = await local.read(row.path)
    const path = remote.path(randomUUID())
    await remote.write(path, bytes, row)
    let committed = false
    try {
      if (!(await remote.read(path)).equals(bytes)) {
        throw new Error('OSS migration content verification failed')
      }
      const result = await source.query('UPDATE resources SET storage_backend=?,object_path=? WHERE id=? AND storage_backend=\'local\' AND object_path=? AND deleted_at IS NULL', [backend, path, row.id, row.path])
      committed = result.affectedRows === 1
    } catch (error) {
      // An ambiguous database result may already be committed. Never delete an object still referenced by SQL.
      const [current] = await source.query('SELECT object_path FROM resources WHERE id=?', [row.id])
      if (current?.object_path !== path) {
        await remote.remove(path)
      }
      throw error
    }
    if (committed) {
      await local.remove(row.path)
      migrated++
    } else {
      await remote.remove(path)
    }
  }
  const icons = await source.query('SELECT id,content,object_path AS path,storage_backend FROM ledger_category_icons WHERE storage_backend=\'local\' OR object_path IS NULL')
  for (const row of icons) {
    const bytes = row.path ? await local.read(row.path) : Buffer.from(row.content)
    const path = remote.path(randomUUID())
    await remote.write(path, bytes, { name: '分类图标.png', mimeType: 'image/png' })
    let committed = false
    try {
      if (!(await remote.read(path)).equals(bytes)) {
        throw new Error('OSS migration content verification failed')
      }
      const result = await source.query('UPDATE ledger_category_icons SET storage_backend=?,object_path=?,content=NULL WHERE id=? AND (storage_backend=\'local\' OR object_path IS NULL)', [backend, path, row.id])
      committed = result.affectedRows === 1
    } catch (error) {
      const [current] = await source.query('SELECT object_path FROM ledger_category_icons WHERE id=?', [row.id])
      if (current?.object_path !== path) {
        await remote.remove(path)
      }
      throw error
    }
    if (committed) {
      if (row.path) {
        await local.remove(row.path)
      }
      migrated++
    } else {
      await remote.remove(path)
    }
  }
  // Resume cleanup after a crash between the committed SQL update and local unlink.
  const locations = await source.query('SELECT id,object_path AS path FROM resources WHERE storage_backend=? AND deleted_at IS NULL UNION ALL SELECT id,object_path AS path FROM ledger_category_icons WHERE storage_backend=?', [backend, backend])
  for (const row of locations) {
    let bytes: Buffer
    try {
      bytes = await local.read(row.id)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }
    if (!(await remote.read(row.path)).equals(bytes)) {
      throw new Error('Local cleanup refused: stored object differs from its OSS copy')
    }
    await local.remove(row.id)
  }
  return { migrated, purged }
}

const entry = process.argv[1] && await realpath(process.argv[1]).catch(() => '')
if (entry && import.meta.url === pathToFileURL(entry).href) {
  if (process.argv.length > 3) {
    throw new Error('Usage: node migrate-local.js [LOCAL_RESOURCE_DIRECTORY]')
  }
  const [{ resourceStorageSettings }, { createDataSource }, { LocalResourceStorage }, { OssResourceStorage, ossResourceBackend }] = await Promise.all([
    import('../config.js'),
    import('../db/data-source.js'),
    import('./storage.js'),
    import('./oss.js'),
  ])
  const options = resourceStorageSettings()
  if (!options) {
    throw new Error('Configure OSS credentials before migrating local files')
  }
  const source = await createDataSource().initialize()
  try {
    const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../.storage/resources/', import.meta.url))
    const result = await migrateLocalResources(source, new LocalResourceStorage(root), new OssResourceStorage(options), ossResourceBackend(options))
    process.stdout.write(`OSS migration completed: ${result.migrated} copied and verified, ${result.purged} deleted resources cleaned.\n`)
  } finally {
    await source.destroy()
  }
}
