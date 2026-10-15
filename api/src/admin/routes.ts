import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import type { ConfigurationService } from './service.js'
import { registerHolidayAdministration } from '@t-box/calendar-server/holiday-admin-routes'
import { registerLedgerCategoryAdministration } from '@t-box/ledger-server/categories/admin-routes'
import { CategoryPresetAdministration } from '@t-box/ledger-server/categories/administration'
import { ApiError } from '@t-box/server-foundation/errors'
import { parseId } from '@t-box/server-foundation/validation'
import { registerApplicationPublishing } from '../application-platform/admin-routes.js'
import { ApplicationPublishing } from '../application-platform/publishing.js'
import { requestKey } from '../payments/service.js'
import { AdminAuth, cookie, sessionToken } from './auth.js'
import { hashPassword } from './crypto.js'
import { bad, body, enabled, password, text } from './validation.js'

export function registerAdmin(
  app: FastifyInstance,
  service: ConfigurationService,
  platform?: PlatformService,
) {
  const auth = new AdminAuth(service.store)
  app.register(
    async (scope) => {
      scope.addHook('onRequest', async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        if (
          !['GET', 'HEAD'].includes(request.method) &&
          request.headers['x-admin-request'] !== '1'
        ) {
          throw new ApiError(403, 'CSRF_REJECTED', '管理请求校验失败')
        }
      })
      scope.post('/session', async (request, reply) => {
        const result = await auth.login(request.body, request.ip)
        reply.header('Set-Cookie', cookie(result.token))
        return { data: result.user }
      })
      scope.register(async (secure) => {
        secure.addHook('preHandler', async (request) => {
          await auth.authenticate(sessionToken(request))
        })
        secure.get('/session', async (request) => ({
          data: await auth.authenticate(sessionToken(request)),
        }))
        secure.delete('/session', async (request, reply) => {
          await auth.logout(sessionToken(request))
          reply.header('Set-Cookie', cookie('', 0)).code(204).send()
        })
        secure.patch('/password', async (request, reply) => {
          const user = await auth.authenticate(sessionToken(request))
          await auth.changePassword(user.id, request.body)
          reply.header('Set-Cookie', cookie('', 0)).code(204).send()
        })
        if (platform) {
          secure.get('/operations', async () => ({ data: await platform.operations.overview() }))
          secure.get('/operations/events', async () => ({ data: await platform.operations.events() }))
          secure.get<{ Params: { id: string } }>('/operations/tasks/:id', async (r) => ({ data: await platform.operations.task(parseId(r.params.id)) }))
          registerLedgerCategoryAdministration(
            secure,
            new CategoryPresetAdministration(service.store.source),
            (r) => auth.authenticate(sessionToken(r)),
          )
          registerHolidayAdministration(
            secure,
            platform.calendar.holidays,
            (r) => auth.authenticate(sessionToken(r)),
          )
          registerApplicationPublishing(
            secure,
            new ApplicationPublishing(
              service.store.source,
              platform.applications,
            ),
            (r) => auth.authenticate(sessionToken(r)),
          )
          secure.get('/payments/recharge-options', async () => ({
            data: await platform.recharge.configuration(),
          }))
          secure.patch('/payments/recharge-options', async (r) => {
            const actor = await auth.authenticate(sessionToken(r))
            return { data: await platform.recharge.save(r.body, actor.id) }
          })
          secure.get('/support', async () => ({
            data: await platform.support.configuration(),
          }))
          secure.patch('/support', async (request) => {
            const actor = await auth.authenticate(sessionToken(request))
            return {
              data: await platform.support.save(request.body, actor.id),
            }
          })
          if (platform.paymentConfiguration) {
            secure.get('/payments/wechat', async () => ({
              data: await platform.paymentConfiguration!.view(),
            }))
            secure.patch(
              '/payments/wechat',
              { bodyLimit: 64 * 1024 },
              async (r) => {
                const actor = await auth.authenticate(sessionToken(r))
                await platform.paymentConfiguration!.save(r.body, actor.id)
                return { data: await platform.paymentConfiguration!.view() }
              },
            )
          }

          secure.get('/billing/users', async (r) => {
            const query = r.query as { search?: unknown }
            const search =
              query.search === undefined || query.search === ''
                ? ''
                : text(query.search, '搜索内容', 64)
            return { data: await platform.billing.users(search) }
          })
          secure.get<{ Params: { id: string } }>(
            '/billing/users/:id/usage',
            async (r) => ({
              data: await platform.billing.records(parseId(r.params.id)),
            }),
          )
          secure.get<{ Params: { id: string } }>(
            '/billing/users/:id/entries',
            async (r) => ({
              data: await platform.billing.entries(parseId(r.params.id)),
            }),
          )
          secure.patch<{ Params: { id: string } }>(
            '/billing/users/:id',
            async (r) => {
              const input = body(r.body, ['mode', 'reason'])
              if (input.mode !== 'charge' && input.mode !== 'record_only') {
                bad('扣费模式无效')
              }
              const actor = await auth.authenticate(sessionToken(r))
              await platform.billing.setMode(
                parseId(r.params.id),
                input.mode as 'charge' | 'record_only',
                actor.id,
                text(input.reason, '调整原因', 200),
              )
              return {
                data: await platform.billing.wallet(parseId(r.params.id)),
              }
            },
          )
          secure.post<{ Params: { id: string } }>(
            '/billing/users/:id/grants',
            async (r) => {
              const input = body(r.body, ['amount', 'reason'])
              const actor = await auth.authenticate(sessionToken(r))
              await platform.billing.grant(
                parseId(r.params.id),
                input.amount as string,
                requestKey(r.headers['idempotency-key']),
                text(input.reason, '赠送原因', 200),
                actor.id,
              )
              return {
                data: await platform.billing.wallet(parseId(r.params.id)),
              }
            },
          )
          secure.post<{ Params: { id: string, usageId: string } }>(
            '/billing/users/:id/usage/:usageId/release',
            async (r) => {
              const input = body(r.body, ['reason'])
              const actor = await auth.authenticate(sessionToken(r))
              await platform.billing.release(
                parseId(r.params.id),
                parseId(r.params.usageId),
                actor.id,
                text(input.reason, '核对原因', 200),
              )
              return {
                data: await platform.billing.wallet(parseId(r.params.id)),
              }
            },
          )
          secure.post<{ Params: { id: string, usageId: string } }>(
            '/billing/users/:id/usage/:usageId/settle',
            async (r) => {
              const input = body(r.body, ['reason'])
              const actor = await auth.authenticate(sessionToken(r))
              await platform.billing.resolve(
                parseId(r.params.id),
                parseId(r.params.usageId),
                actor.id,
                text(input.reason, '核对原因', 200),
              )
              return {
                data: await platform.billing.wallet(parseId(r.params.id)),
              }
            },
          )
          secure.get('/payments/orders', async () => ({
            data: await platform.payments.adminList(),
          }))
          secure.get('/payments/refunds', async () => ({ data: await platform.refunds.list() }))
          secure.get('/payments/reconciliations', async () => ({ data: await platform.paymentReconciliation.list() }))
          secure.post('/payments/reconciliations', async (r) => {
            const input = body(r.body, ['day'])
            return { data: await platform.paymentReconciliation.run(text(input.day, '账单日期', 10)) }
          })
          secure.post<{ Params: { id: string } }>('/payments/orders/:id/refunds', async (r) => {
            const actor = await auth.authenticate(sessionToken(r))
            const input = body(r.body, ['reason'])
            return { data: await platform.refunds.create(parseId(r.params.id), actor.id, text(input.reason, '退款原因', 80), requestKey(r.headers['idempotency-key'])) }
          })
          secure.post<{ Params: { id: string } }>('/payments/refunds/:id/reconcile', async (r) => {
            const id = parseId(r.params.id)
            await platform.refunds.process(id)
            return { data: await platform.refunds.get(id) }
          })
          secure.get('/payments/capabilities', async () => ({
            data: await platform.payments.capabilities(),
          }))
          secure.post<{ Params: { id: string } }>(
            '/payments/orders/:id/reconcile',
            async (r) => ({
              data: await platform.payments.reconcile(parseId(r.params.id)),
            }),
          )
        }
        secure.get('/providers', async () => ({
          data: await service.store.providers(),
        }))
        secure.get('/configuration', async () => ({
          data: await service.configuration.view(),
        }))
        secure.get<{ Params: { key: string } }>(
          '/configuration/:key/history',
          async (r) => ({
            data: await service.configuration.history(r.params.key),
          }),
        )
        secure.patch<{ Params: { key: string } }>(
          '/configuration/:key',
          { bodyLimit: 64 * 1024 },
          async (r) => {
            const actor = await auth.authenticate(sessionToken(r))
            return {
              data: await service.configuration.save(
                r.params.key,
                r.body,
                actor.id,
              ),
            }
          },
        )
        secure.post('/providers', async (request, reply) =>
          reply
            .code(201)
            .send({ data: { id: await service.saveProvider(request.body) } }))
        secure.patch<{ Params: { id: string } }>(
          '/providers/:id',
          async (request) => ({
            data: {
              id: await service.saveProvider(
                request.body,
                parseId(request.params.id),
              ),
            },
          }),
        )
        secure.get<{ Params: { id: string } }>(
          '/providers/:id/models',
          async (request) => ({
            data: await service.remoteModels(parseId(request.params.id)),
          }),
        )
        secure.delete<{ Params: { id: string } }>(
          '/providers/:id',
          async (request, reply) => {
            await service.remove('providers', parseId(request.params.id))
            reply.code(204).send()
          },
        )
        secure.get('/models', async () => ({
          data: await service.store.models(),
        }))
        secure.post('/models', async (request, reply) =>
          reply
            .code(201)
            .send({ data: { id: await service.saveModel(request.body) } }))
        secure.patch<{ Params: { id: string } }>(
          '/models/:id',
          async (request) => ({
            data: {
              id: await service.saveModel(
                request.body,
                parseId(request.params.id),
              ),
            },
          }),
        )
        secure.delete<{ Params: { id: string } }>(
          '/models/:id',
          async (request, reply) => {
            await service.remove('models', parseId(request.params.id))
            reply.code(204).send()
          },
        )
        secure.post<{ Params: { id: string } }>(
          '/models/:id/test',
          async (request) => ({
            data: await service.testModel(parseId(request.params.id)),
          }),
        )
        secure.get('/workflow', async () => ({
          data: await service.workflow.snapshot(),
        }))
        secure.get('/workflow/defaults', async () => ({
          data: service.workflow.defaults(),
        }))
        secure.patch('/workflow', { bodyLimit: 64 * 1024 }, async (request) => {
          const actor = await auth.authenticate(sessionToken(request))
          return { data: await service.workflow.save(request.body, actor.id) }
        })
        secure.get('/settings', async () => ({
          data: await service.store.settings(),
        }))
        secure.patch('/settings', async (request) => ({
          data: await service.selectModel(request.body),
        }))
        secure.get('/users', async () => ({
          data: await service.store.users(),
        }))
        secure.post('/users', async (request, reply) => {
          const input = body(request.body, ['username', 'password'])
          const username = text(input.username, '账号', 64)
          if (!/^[\w.-]{3,64}$/.test(username)) {
            bad('账号仅支持 3–64 位字母、数字、下划线、点和短横线')
          }
          const id = await service.store.createUser(
            username,
            await hashPassword(password(input.password)),
          )
          return reply.code(201).send({ data: { id } })
        })
        secure.patch<{ Params: { id: string } }>(
          '/users/:id',
          async (request, reply) => {
            const id = parseId(request.params.id)
            const input = body(request.body, ['enabled'])
            const active = enabled(input.enabled)
            const current = await auth.authenticate(sessionToken(request))
            if (id === current.id && !active) {
              bad('不能停用当前登录账号')
            }
            await auth.setUserEnabled(id, active)
            reply.code(204).send()
          },
        )
      })
    },
    { prefix: '/api/v1/admin' },
  )
}
