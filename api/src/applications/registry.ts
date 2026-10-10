import type { CalendarService } from '@t-box/calendar-server/service'
import type { LedgerServices } from '@t-box/ledger-server/ai/ports'
import type { CategoryRepository } from '@t-box/ledger-server/categories/repository'
import type { BillRepository } from '@t-box/ledger-server/repository'
import type { TimeService } from '@t-box/time-server/service'
import type { ApplicationModule } from '../application-sdk/contracts.js'
import type { PlatformService } from '../platform/service.js'
import { createCalculatorModule } from '@t-box/calculator-server'
import {
  calendarAccessAdapter,
  createCalendarModule,
} from '@t-box/calendar-server/module'
import { createImagesModule } from '@t-box/images-server/module'
import { ledgerAccessAdapter } from '@t-box/ledger-server/ai/access'
import { createLedgerModule } from '@t-box/ledger-server/ai/module'
import { createTimeModule, timeAccessAdapter } from '@t-box/time-server/module'

export function createApplicationResourceAdapters(
  services: LedgerServices & { calendar?: CalendarService, time?: TimeService },
) {
  return [
    ledgerAccessAdapter(services.access),
    ...(services.calendar ? [calendarAccessAdapter(services.calendar)] : []),
    ...(services.time ? [timeAccessAdapter(services.time)] : []),
  ]
}

/** First-party composition; adding an application never modifies the AI runner. */
export function createApplicationModules(options: {
  platform?: PlatformService
  bills: BillRepository
  categories?: CategoryRepository
}): ApplicationModule[] {
  return [
    createLedgerModule(options),
    createImagesModule(options.platform?.images),
    createCalculatorModule(),
    createCalendarModule(options.platform?.calendar),
    createTimeModule(options.platform?.time),
  ]
}
