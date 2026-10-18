import type {
  AppRelease,
  LifecycleAction,
  PublicationStatus,
} from '@t-box/app-contracts'
import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredApplicationBuildImport {
  app_id: string
  version: string
  release_id: string
  bundle_sha256: string
  object_url: string
  source: JsonDocument
  credential_id: string
  created_at: string
}

export const ApplicationBuildImportEntity =
  new EntitySchema<StoredApplicationBuildImport>({
    name: 'ApplicationBuildImport',
    tableName: 'application_build_imports',
    columns: {
      app_id: { type: 'varchar', name: 'app_id', length: 64, primary: true },
      version: { type: 'varchar', length: 48, primary: true },
      release_id: { type: 'varchar', name: 'release_id', length: 80 },
      bundle_sha256: { type: 'char', name: 'bundle_sha256', length: 64 },
      object_url: { type: 'varchar', name: 'object_url', length: 1000 },
      source: { type: 'json' },
      credential_id: { type: 'char', name: 'credential_id', length: 36 },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [{ name: 'release_id', columns: ['release_id'], unique: true }],
  })

export interface StoredApplicationFileGrant {
  user_id: string
  app_id: string
  generation: number
  resource_id: string
  created_at: string
}

export const ApplicationFileGrantEntity =
  new EntitySchema<StoredApplicationFileGrant>({
    name: 'ApplicationFileGrant',
    tableName: 'application_file_grants',
    columns: {
      user_id: { type: 'char', name: 'user_id', length: 36, primary: true },
      app_id: { type: 'varchar', name: 'app_id', length: 64, primary: true },
      generation: { type: 'int', primary: true },
      resource_id: {
        type: 'char',
        name: 'resource_id',
        length: 36,
        primary: true,
      },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [{ name: 'app_file_resource', columns: ['resource_id'] }],
  })

export interface StoredApplicationImportCredential {
  id: string
  token_hash: string
  administrator_id: string
  apps: JsonDocument
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  managed_key: string | null
}

export const ApplicationImportCredentialEntity =
  new EntitySchema<StoredApplicationImportCredential>({
    name: 'ApplicationImportCredential',
    tableName: 'application_import_credentials',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      token_hash: {
        type: 'char',
        name: 'token_hash',
        length: 64,
        select: false,
      },
      administrator_id: { type: 'char', name: 'administrator_id', length: 36 },
      apps: { type: 'json' },
      expires_at: {
        type: 'datetime',
        name: 'expires_at',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
      revoked_at: {
        type: 'datetime',
        name: 'revoked_at',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      managed_key: {
        type: 'varchar',
        name: 'managed_key',
        length: 32,
        nullable: true,
      },
    },
    indices: [
      { name: 'managed_key', columns: ['managed_key'], unique: true },
      { name: 'token_hash', columns: ['token_hash'], unique: true },
    ],
  })

export interface StoredApplicationInstallation {
  user_id: string
  app_id: string
  release_id: string
  target_release_id: string | null
  generation: number
  status: string
  grants: JsonDocument
  operation_id: string | null
  updated_at: string
  error: string | null
  retry_attempts: number
  retry_at: string | null
}

export const ApplicationInstallationEntity =
  new EntitySchema<StoredApplicationInstallation>({
    name: 'ApplicationInstallation',
    tableName: 'application_installations',
    columns: {
      user_id: { type: 'char', name: 'user_id', length: 36, primary: true },
      app_id: { type: 'varchar', name: 'app_id', length: 64, primary: true },
      release_id: { type: 'varchar', name: 'release_id', length: 80 },
      target_release_id: {
        type: 'varchar',
        name: 'target_release_id',
        length: 80,
        nullable: true,
      },
      generation: { type: 'int', unsigned: true },
      status: { type: 'varchar', length: 20 },
      grants: { type: 'json' },
      operation_id: {
        type: 'char',
        name: 'operation_id',
        length: 36,
        nullable: true,
      },
      updated_at: {
        type: 'datetime',
        name: 'updated_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      error: { type: 'varchar', length: 300, nullable: true },
      retry_attempts: { type: 'int', name: 'retry_attempts', unsigned: true },
      retry_at: {
        type: 'datetime',
        name: 'retry_at',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [],
  })

export interface StoredApplicationLifecycleOperation {
  id: string
  user_id: string
  app_id: string
  request_key: string
  request_hash: string
  release_id: string
  generation: number
  action: LifecycleAction
  status: string
  submitted: number
  attempts: number
  lease_token: string | null
  lease_until: string | null
  next_attempt_at: string
  receipt: JsonDocument
  error: string | null
  created_at: string
  updated_at: string
}

export const ApplicationLifecycleOperationEntity =
  new EntitySchema<StoredApplicationLifecycleOperation>({
    name: 'ApplicationLifecycleOperation',
    tableName: 'application_lifecycle_operations',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      user_id: { type: 'char', name: 'user_id', length: 36 },
      app_id: { type: 'varchar', name: 'app_id', length: 64 },
      request_key: { type: 'varchar', name: 'request_key', length: 80 },
      request_hash: { type: 'char', name: 'request_hash', length: 64 },
      release_id: { type: 'varchar', name: 'release_id', length: 80 },
      generation: { type: 'int', unsigned: true },
      action: { type: 'varchar', length: 16 },
      status: { type: 'varchar', length: 20 },
      submitted: { type: 'tinyint' },
      attempts: { type: 'int', unsigned: true },
      lease_token: {
        type: 'char',
        name: 'lease_token',
        length: 36,
        nullable: true,
      },
      lease_until: {
        type: 'datetime',
        name: 'lease_until',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
      next_attempt_at: {
        type: 'datetime',
        name: 'next_attempt_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      receipt: { type: 'json', nullable: true },
      error: { type: 'varchar', length: 300, nullable: true },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      updated_at: {
        type: 'datetime',
        name: 'updated_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      {
        name: 'app_operation_queue',
        columns: ['status', 'next_attempt_at', 'lease_until'],
      },
      {
        name: 'app_operation_request',
        columns: ['user_id', 'app_id', 'request_key'],
        unique: true,
      },
    ],
  })

export interface StoredApplicationPublicationEvent {
  id: string
  app_id: string
  release_id: string
  action: string
  administrator_id: string
  detail: JsonDocument
  created_at: string
}

export const ApplicationPublicationEventEntity =
  new EntitySchema<StoredApplicationPublicationEvent>({
    name: 'ApplicationPublicationEvent',
    tableName: 'application_publication_events',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      app_id: { type: 'varchar', name: 'app_id', length: 64 },
      release_id: { type: 'varchar', name: 'release_id', length: 80 },
      action: { type: 'varchar', length: 24 },
      administrator_id: { type: 'char', name: 'administrator_id', length: 36 },
      detail: { type: 'json' },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'app_publication_history', columns: ['app_id', 'created_at'] },
    ],
  })

export interface StoredApplicationRegistry {
  app_id: string
  kind: AppRelease['kind']
  created_at: string
}

export const ApplicationRegistryEntity =
  new EntitySchema<StoredApplicationRegistry>({
    name: 'ApplicationRegistry',
    tableName: 'application_registry',
    columns: {
      app_id: { type: 'varchar', name: 'app_id', length: 64, primary: true },
      kind: { type: 'varchar', length: 16 },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [],
  })

export interface StoredApplicationRelease {
  release_id: string
  app_id: string
  definition: AppRelease
  definition_hash: string
  published: number
  created_at: string
  status: PublicationStatus
  revision: number
  release_notes: string | null
  submitted_by: string | null
  submitted_at: string | null
  published_by: string | null
  published_at: string | null
}

export const ApplicationReleaseEntity =
  new EntitySchema<StoredApplicationRelease>({
    name: 'ApplicationRelease',
    tableName: 'application_releases',
    columns: {
      release_id: {
        type: 'varchar',
        name: 'release_id',
        length: 80,
        primary: true,
      },
      app_id: { type: 'varchar', name: 'app_id', length: 64 },
      definition: { type: 'json' },
      definition_hash: { type: 'char', name: 'definition_hash', length: 64 },
      published: { type: 'tinyint' },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      status: { type: 'varchar', length: 16 },
      revision: { type: 'int', unsigned: true },
      release_notes: { type: 'text', name: 'release_notes', nullable: true },
      submitted_by: {
        type: 'char',
        name: 'submitted_by',
        length: 36,
        nullable: true,
      },
      submitted_at: {
        type: 'datetime',
        name: 'submitted_at',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
      published_by: {
        type: 'char',
        name: 'published_by',
        length: 36,
        nullable: true,
      },
      published_at: {
        type: 'datetime',
        name: 'published_at',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'application_catalog', columns: ['app_id', 'published'] },
    ],
  })
