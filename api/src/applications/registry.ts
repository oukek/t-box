import type { BabyDiaryService } from '@t-box/baby-diary-server'
import type { CalendarService } from '@t-box/calendar-server/service'
import type { LedgerServices } from '@t-box/ledger-server/ai/ports'
import type { CategoryRepository } from '@t-box/ledger-server/categories/repository'
import type { BillRepository } from '@t-box/ledger-server/repository'
import type { TimeService } from '@t-box/time-server/service'
import type { ApplicationModule } from '../application-sdk/contracts.js'
import type { PlatformService } from '../platform/service.js'
import { createBabyDiaryModule } from '@t-box/baby-diary-server'
import { createCalculatorModule } from '@t-box/calculator-server'
import {
  calendarAccessAdapter,
  createCalendarModule,
} from '@t-box/calendar-server/module'
import { createConverterModule } from '@t-box/converter-server'
import { createImagesModule } from '@t-box/images-server/module'
import { ledgerAccessAdapter } from '@t-box/ledger-server/ai/access'
import { createLedgerModule } from '@t-box/ledger-server/ai/module'
import { createTimeModule, timeAccessAdapter } from '@t-box/time-server/module'
import { ErrorCode } from '../error-codes.js'

export function createApplicationResourceAdapters(
  services: LedgerServices & {
    calendar?: CalendarService
    time?: TimeService
    babyDiary?: BabyDiaryService
    applications?: PlatformService['applications']
  },
) {
  return [
    ...(services.babyDiary && services.applications
      ? [
          createBabyDiaryModule({
            invoke: async () => {
              throw ErrorCode.APP_PERMISSION_DENIED()
            },
            inspect: async (actor, babyId, action, type) => {
              const apps = services.applications!
              await apps.assertActive(actor.user.id, 'baby-diary')
              await services.babyDiary!.inspect(
                apps.subject(actor.user.id, 'baby-diary'),
                babyId,
                action,
                type,
              )
            },
          }).access!,
        ]
      : []),
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
    createBabyDiaryModule(
      options.platform
        ? {
            invoke: async (ctx, method, args) => {
              if (!ctx.actor) {
                throw ErrorCode.APP_PERMISSION_DENIED()
              }
              const apps = options.platform!.applications
              const { installation } = await apps.assertActive(
                ctx.actor.user.id,
                'baby-diary',
                ctx.application,
              )
              return apps.invoke(
                ctx.actor.user.id,
                'baby-diary',
                installation.releaseId,
                installation.generation,
                method,
                args,
                ctx.callId || ctx.requestId,
                ctx.signal,
              )
            },
            inspect: async (actor, babyId, action, type) => {
              const apps = options.platform!.applications
              await apps.assertActive(actor.user.id, 'baby-diary')
              await options.platform!.babyDiary.inspect(
                apps.subject(actor.user.id, 'baby-diary'),
                babyId,
                action,
                type,
              )
            },
          }
        : undefined,
    ),
    createLedgerModule(options),
    createImagesModule(options.platform?.images),
    createCalculatorModule(),
    createConverterModule(),
    createCalendarModule(options.platform?.calendar),
    createTimeModule(options.platform?.time),
  ]
}
