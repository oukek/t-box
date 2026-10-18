import type { DataSource } from 'typeorm'
import type { OssResourceStorage } from './oss.js'
import type { LocalResourceStorage } from './storage.js'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LedgerCategoryIconEntity } from '@t-box/ledger-server/persistence/categories-entities'
import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { IsNull, Not } from 'typeorm'
import { ErrorCode } from '../error-codes.js'

/** Copy and verify first, commit the new location, then remove only the proven local object. */
export async function migrateLocalResources(
  source: DataSource,
  local: LocalResourceStorage,
  remote: OssResourceStorage,
  backend: string,
) {
  let migrated = 0
  let purged = 0
  const resources = await source
    .getRepository(ResourceEntity)
    .find({
      select: {
        id: true,
        name: true,
        mime_type: true,
        object_path: true,
        deleted_at: true,
      },
      where: { storage_backend: 'local' },
    })
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        mimeType: row.mime_type,
        path: row.object_path,
        deleted_at: row.deleted_at,
      })),
    )
  for (const row of resources) {
    if (row.deleted_at) {
      await local.remove(row.path)
      await source
        .getRepository(ResourceEntity)
        .update(
          { id: row.id, storage_backend: 'local', deleted_at: Not(IsNull()) },
          { purged_at: () => 'COALESCE(purged_at,UTC_TIMESTAMP(3))' },
        )
      purged++
      continue
    }
    const bytes = await local.read(row.path)
    const path = remote.path(randomUUID())
    await remote.write(path, bytes, row)
    let committed = false
    try {
      if (!(await remote.read(path)).equals(bytes)) {
        throw ErrorCode.INTERNAL_OSS_MIGRATION_CONTENT_VERIFICATION_FAILED()
      }
      const result = await source.getRepository(ResourceEntity).update(
        {
          id: row.id,
          storage_backend: 'local',
          object_path: row.path,
          deleted_at: IsNull(),
        },
        { storage_backend: backend, object_path: path },
      )
      committed = result.affected === 1
    } catch (error) {
      // An ambiguous database result may already be committed. Never delete an object still referenced by SQL.
      const current = await source
        .getRepository(ResourceEntity)
        .findOne({ select: { object_path: true }, where: { id: row.id } })
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
  const icons = await source
    .createQueryBuilder()
    .select('id,content,object_path AS path,storage_backend')
    .from('ledger_category_icons', 'ledger_category_icons')
    .where('storage_backend=\'local\' OR object_path IS NULL')
    .getRawMany()
  for (const row of icons) {
    const bytes = row.path
      ? await local.read(row.path)
      : Buffer.from(row.content)
    const path = remote.path(randomUUID())
    await remote.write(path, bytes, {
      name: '分类图标.png',
      mimeType: 'image/png',
    })
    let committed = false
    try {
      if (!(await remote.read(path)).equals(bytes)) {
        throw ErrorCode.INTERNAL_OSS_MIGRATION_CONTENT_VERIFICATION_FAILED()
      }
      const result = await source
        .createQueryBuilder()
        .update('ledger_category_icons')
        .set({ storage_backend: backend, object_path: path, content: null })
        .updateEntity(false)
        .where('id=:p2 AND (storage_backend=\'local\' OR object_path IS NULL)')
        .setParameters({ p2: row.id })
        .execute()
      committed = result.affected === 1
    } catch (error) {
      const current = await source
        .getRepository(LedgerCategoryIconEntity)
        .findOne({
          select: { id: true, object_path: true },
          where: { id: row.id },
        })
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
  // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
  const locations = await source.query(
    'SELECT id,object_path AS path FROM resources WHERE storage_backend=? AND deleted_at IS NULL UNION ALL SELECT id,object_path AS path FROM ledger_category_icons WHERE storage_backend=?',
    [backend, backend],
  )
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
      throw ErrorCode.INTERNAL_LOCAL_CLEANUP_REFUSED_STORED_OBJECT_DIFFERS_FROM_ITS_OSS_COPY()
    }
    await local.remove(row.id)
  }
  return { migrated, purged }
}

const entry =
  process.argv[1] && (await realpath(process.argv[1]).catch(() => ''))
if (entry && import.meta.url === pathToFileURL(entry).href) {
  if (process.argv.length > 3) {
    throw ErrorCode.INTERNAL_USAGE_NODE_MIGRATE_LOCAL_JS_LOCAL_RESOURCE_DIRECTORY()
  }
  const [
    { resourceStorageSettings },
    { createDataSource },
    { LocalResourceStorage },
    { OssResourceStorage, ossResourceBackend },
  ] = await Promise.all([
    import('../config.js'),
    import('../db/data-source.js'),
    import('./storage.js'),
    import('./oss.js'),
  ])
  const options = resourceStorageSettings()
  if (!options) {
    throw ErrorCode.INTERNAL_CONFIGURE_OSS_CREDENTIALS_BEFORE_MIGRATING_LOCAL_FILES()
  }
  const source = await createDataSource().initialize()
  try {
    const root = process.argv[2]
      ? resolve(process.argv[2])
      : fileURLToPath(new URL('../../.storage/resources/', import.meta.url))
    const result = await migrateLocalResources(
      source,
      new LocalResourceStorage(root),
      new OssResourceStorage(options),
      ossResourceBackend(options),
    )
    process.stdout.write(
      `OSS migration completed: ${result.migrated} copied and verified, ${result.purged} deleted resources cleaned.\n`,
    )
  } finally {
    await source.destroy()
  }
}
