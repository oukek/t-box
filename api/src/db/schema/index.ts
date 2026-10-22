import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import { babyDiarySchema } from '@t-box/baby-diary-server'
import { calendarSchema } from '@t-box/calendar-server/schema'
import { ledgerSchema } from '@t-box/ledger-server/schema'
import { timeSchema } from '@t-box/time-server/schema'
import { aiSchema } from './ai.js'
import { applicationsSchema } from './applications.js'
import { billingSchema } from './billing.js'
import { configurationSchema } from './configuration.js'
import { desktopSchema } from './desktop.js'
import { identitySchema } from './identity.js'
import { memorySchema } from './memory.js'
import { operationsSchema } from './operations.js'
import { privateMediaSchema } from './private-media.js'
import { resourcesSchema } from './resources.js'

/** Composition only: application business tables and defaults belong to each app. */
export const databaseSchemas: readonly DatabaseSchema[] = [
  identitySchema,
  aiSchema,
  billingSchema,
  applicationsSchema,
  resourcesSchema,
  configurationSchema,
  memorySchema,
  desktopSchema,
  operationsSchema,
  ledgerSchema,
  calendarSchema,
  timeSchema,
  babyDiarySchema,
  privateMediaSchema,
]
