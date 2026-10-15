import type { CategoryRepository } from '@t-box/ledger-server/categories/repository'
import type { BillRepository } from '@t-box/ledger-server/repository'
import type { BillInput } from '@t-box/shared'
import type { FastifyServerOptions } from 'fastify'
import type { ConfigurationService } from './admin/service.js'
import type { ApplicationModule } from './agent/contracts.js'
import type { ChatProvider } from './chat/provider.js'
import type { SessionRepository } from './chat/session.js'
import type { PlatformService } from './platform/service.js'
import { randomUUID } from 'node:crypto'
import cors from '@fastify/cors'
import { ApplicationError } from '@t-box/app-server-sdk'
import { registerCalculator } from '@t-box/calculator-server'
import { registerCalendar } from '@t-box/calendar-server/routes'
import { parseCategoryInput } from '@t-box/ledger-server/categories/validation'
import { notFound } from '@t-box/ledger-server/errors'
import {
  parseBillInput,
  parseId,
  parseListFilters,
  parseSummaryQuery,
} from '@t-box/ledger-server/validation'
import { ApiError } from '@t-box/server-foundation/errors'
import { registerTime } from '@t-box/time-server/routes'
import Fastify from 'fastify'
import { registerAdmin } from './admin/routes.js'
import { ApplicationBuildImports } from './application-platform/build-import.js'
import { registerApplicationBuildImports } from './application-platform/import-routes.js'
import { ApplicationPublishing } from './application-platform/publishing.js'
import { registerApplicationPlatform } from './application-platform/routes.js'
import { registerBilling } from './billing/routes.js'
import { ApplicationChatService as ChatService } from './bootstrap/chat.js'
import { UnconfiguredProvider } from './chat/provider.js'
import { registerChatSocket } from './chat/websocket.js'
import { settingNumber } from './configuration/defaults.js'
import { registerDesktop } from './desktop/routes.js'
import { registerApplicationCatalog } from './platform/application-catalog.js'
import { registerPlatform } from './platform/routes.js'
import { registerLedgerSocket } from './platform/socket.js'
import { registerApplicationFiles } from './resources/application-file-routes.js'
import { registerResources } from './resources/routes.js'
import { registerCustomerSupport } from './support/routes.js'
import { registerTasks } from './tasks/routes.js'
import { TaskRecoveryWorker } from './tasks/worker.js'

export interface DependencyHealth {
  mysql: 'up' | 'down'
  redis: 'up' | 'down' | 'disabled'
}

export interface AppDependencies {
  trustedProxies?: string[]
  administration?: ConfigurationService
  platform?: PlatformService
  bills: BillRepository
  categories?: CategoryRepository
  health: () => Promise<DependencyHealth>
  close?: () => Promise<void>
  corsOrigins?: string[]
  logger?: FastifyServerOptions['logger']
  chatProvider?: ChatProvider
  chatSessions?: SessionRepository
  applicationModules?: ApplicationModule[]
  taskWorker?: boolean
}

export function createApp(deps: AppDependencies) {
  const app = Fastify({
    genReqId: () => randomUUID(),
    trustProxy: deps.trustedProxies ?? false,
    logger: deps.logger ?? false,
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
  })
  let recoveryTimer: ReturnType<typeof setInterval> | undefined
  if (deps.platform?.tasks) {
    app.addHook('onReady', async () => {
      await deps.platform!.applications?.initialize()
      await deps.platform!.applications?.recover()
      await deps.platform!.tasks.recover()
      recoveryTimer = setInterval(() => {
        void deps.platform!.tasks.recover().catch(() => {})
        void deps.platform!.notifications.recover().catch(() => app.log.warn({ code: 'NOTIFICATION_RECOVERY_FAILED' }, 'Inbox delivery will retry'))
        void deps.platform!.billing.recover().catch(() => {})
        void deps.platform!.resources.purgeDeleted().catch(() => app.log.warn({ code: 'RESOURCE_PURGE_FAILED' }, 'Private resource deletion will retry'))
        void deps.platform!.refunds.recover().catch(() => app.log.warn({ code: 'REFUND_RECOVERY_FAILED' }, 'Refund reconciliation failed'))
        void deps.platform!.paymentReconciliation.recover().catch(() => app.log.warn({ code: 'STATEMENT_RECOVERY_FAILED' }, 'Merchant statement reconciliation failed'))
        void deps.platform!.applications?.recover().catch(() => {})
      }, 30_000)
      recoveryTimer.unref()
    })
  }
  const chat = new ChatService({
    provider: deps.chatProvider ?? new UnconfiguredProvider(),
    bills: deps.bills,
    categories: deps.categories,
    platform: deps.platform,
    sessions: deps.chatSessions,
    modules: deps.applicationModules,
    workflow: deps.administration?.workflow,
    configuration: deps.administration?.configuration,
    onRunError: (error) => {
      app.log.warn(error, 'Agent run interrupted')
      if (!['SERVER_SHUTDOWN', 'CLIENT_REQUIRED', 'RUN_CANCELLED'].includes(error.code)) {
        void deps.platform?.operations?.record({ kind: 'task_error', code: error.code, taskId: error.runId, requestId: error.requestId, stage: error.stage, agentId: error.agentId, httpStatus: error.diagnostics?.httpStatus, providerRequestId: error.diagnostics?.providerRequestId }).catch(() => app.log.warn({ code: 'OPERATIONS_WRITE_FAILED' }, 'Operational event not saved'))
      }
    },
  })
  const worker = deps.taskWorker && deps.platform?.tasks
    ? new TaskRecoveryWorker(deps.platform.tasks, chat, async () => settingNumber(await deps.administration?.configuration.snapshot(), 'ai.worker.concurrency', 2), (code, taskId) => {
        app.log.warn({ code, taskId }, 'Background task recovery paused')
        void deps.platform?.operations.record({ kind: 'recovery_error', code, taskId }).catch(() => {})
      })
    : undefined
  if (deps.administration) {
    app.addHook('onReady', async () => {
      const { platformDefinitions } =
        await import('./configuration/defaults.js')
      await deps.administration!.configuration.register(platformDefinitions)
    })
  }
  app.addHook('onReady', async () => worker?.start())
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id)
  })
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500 && deps.platform?.operations) {
      await deps.platform.operations.record({ kind: 'http_error', code: 'HTTP_SERVER_ERROR', requestId: request.id, httpStatus: reply.statusCode, durationMs: reply.elapsedTime }).catch(() => {})
    }
  })
  registerChatSocket(app, chat, deps.corsOrigins, (scope, allowed) => {
    if (deps.platform) {
      registerLedgerSocket(scope, deps.platform, allowed)
    }
  })

  if (deps.administration) {
    registerAdmin(app, deps.administration, deps.platform)
    if (deps.platform?.applications) {
      registerApplicationBuildImports(app, new ApplicationBuildImports(
        deps.administration.store.source,
        new ApplicationPublishing(deps.administration.store.source, deps.platform.applications),
      ))
    }
  }

  app.register(cors, {
    origin: deps.corsOrigins ?? [],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  app.setErrorHandler((error, request, reply) => {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return reply.code(409).send({
        error: {
          code: 'ALREADY_EXISTS',
          message: /\/categories(?:[/?]|$)/.test(request.url)
            ? '此收支类型下已存在同名分类'
            : '账号或该服务商下的模型已存在',
        },
      })
    }
    if (error instanceof ApplicationError) {
      return reply
        .code(400)
        .send({ error: { code: error.code, message: error.message } })
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      })
    }
    const errorInfo = error as {
      statusCode?: number
      code?: string
      name?: string
    }
    if (errorInfo.statusCode && errorInfo.statusCode < 500) {
      const tooLarge = errorInfo.statusCode === 413
      return reply.code(errorInfo.statusCode).send({
        error: {
          code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
          message: tooLarge
            ? '请求内容过大'
            : '请求格式不正确，请使用 application/json',
        },
      })
    }
    // Avoid SQL text, connection configuration, and user content in server logs.
    request.log.error(
      { code: errorInfo.code ?? 'UNKNOWN', name: errorInfo.name },
      'Request failed',
    )
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用，请稍后重试',
      },
    })
  })

  app.setNotFoundHandler((_request, reply) => {
    return reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
  })

  app.get('/api/v1/health', async (_request, reply) => {
    const dependencies = await deps.health()
    const status =
      dependencies.mysql === 'down'
        ? 'unavailable'
        : dependencies.redis === 'down'
          ? 'degraded'
          : 'ok'
    return reply
      .code(dependencies.mysql === 'up' ? 200 : 503)
      .send({ data: { status, dependencies } })
  })

  if (deps.platform) {
    if (deps.platform.applications) {
      registerApplicationPlatform(app, deps.platform.applications, (token) =>
        deps.platform!.identity.authenticate(token))
    }
    if (deps.platform.desktop) {
      registerDesktop(
        app,
        deps.platform.desktop,
        (token) => deps.platform!.identity.authenticate(token),
        new Set(chat.registry.manifests.map((m) => m.id)),
      )
    }
    registerPlatform(app, deps.platform)
    registerCalendar(app, deps.platform.calendar, async (token) => {
      const actor = await deps.platform!.identity.authenticate(token)
      await deps.platform!.applications?.assertActive(actor.user.id, 'calendar')
      return actor
    })
    registerTime(app, deps.platform.time, async (token) => {
      const actor = await deps.platform!.identity.authenticate(token)
      await deps.platform!.applications?.assertActive(actor.user.id, 'time')
      return actor
    })
    registerCalculator(app, async (token) => {
      const actor = await deps.platform!.identity.authenticate(token)
      await deps.platform!.applications?.assertActive(
        actor.user.id,
        'calculator',
      )
      return actor
    })
    registerApplicationCatalog(app, chat.registry, (token) =>
      deps.platform!.identity.authenticate(token))
    registerBilling(app, deps.platform)
    registerCustomerSupport(app, deps.platform)
    registerResources(app, deps.platform)
    registerApplicationFiles(app, deps.platform)
    if (deps.platform.tasks) {
      registerTasks(app, deps.platform, chat.registry)
    }
  } else {
    const categories = () => {
      if (!deps.categories) {
        throw new ApiError(503, 'CATEGORIES_UNAVAILABLE', '分类服务不可用')
      }
      return deps.categories
    }
    app.get('/api/v1/categories', async () => ({
      data: await categories().list(),
    }))
    app.post('/api/v1/categories', async (request, reply) => {
      const category = await categories().create(
        parseCategoryInput(request.body),
      )
      return reply
        .code(201)
        .header('Location', `/api/v1/categories/${category.id}`)
        .send({ data: category })
    })

    app.get('/api/v1/bills', async (request) => {
      const filters = parseListFilters(request.query)
      const result = await deps.bills.list(filters)
      return {
        data: result.data,
        meta: {
          page: filters.page,
          pageSize: filters.pageSize,
          total: result.total,
        },
      }
    })

    app.get('/api/v1/bills/summary', async (request) => {
      return {
        data: await deps.bills.summary(parseSummaryQuery(request.query)),
      }
    })

    app.get<{ Params: { id: string } }>(
      '/api/v1/bills/:id',
      async (request) => {
        const bill = await deps.bills.get(parseId(request.params.id))
        if (!bill) {
          notFound()
        }
        return { data: bill }
      },
    )

    app.post('/api/v1/bills', async (request, reply) => {
      const input = parseBillInput(request.body) as BillInput
      await categories().validate(input)
      const bill = await deps.bills.create(input)
      return reply
        .code(201)
        .header('Location', `/api/v1/bills/${bill.id}`)
        .send({ data: bill })
    })

    app.patch<{ Params: { id: string } }>(
      '/api/v1/bills/:id',
      async (request) => {
        const id = parseId(request.params.id)
        const patch = parseBillInput(request.body, true)
        const current = await deps.bills.get(id)
        if (!current) {
          notFound()
        }
        const merged = { ...current, ...patch }
        await categories().validate(merged)
        // Write this coupled pair together, so concurrent partial updates cannot
        // produce an invalid type/category combination between validation and SQL.
        const changes =
          patch.type || patch.category
            ? { ...patch, type: merged.type, category: merged.category }
            : patch
        const bill = await deps.bills.update(id, changes)
        if (!bill) {
          notFound()
        }
        return { data: bill }
      },
    )

    app.delete<{ Params: { id: string } }>(
      '/api/v1/bills/:id',
      async (request, reply) => {
        const removed = await deps.bills.delete(parseId(request.params.id))
        if (!removed) {
          notFound()
        }
        return reply.code(204).send()
      },
    )
  }

  app.addHook('onClose', async () => {
    clearInterval(recoveryTimer)
    await worker?.stopScheduling()
    await chat.close()
    await worker?.drain()
    await deps.close?.()
  })
  return app
}
