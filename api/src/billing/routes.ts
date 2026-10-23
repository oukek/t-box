import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { object } from '@t-box/server-foundation/input'
import { parseId } from '@t-box/server-foundation/validation'
import { bearer } from '../identity/service.js'
import { requestKey } from '../payments/service.js'

export function registerBilling(app: FastifyInstance, p: PlatformService) {
  app.addHook('onSend', async (request, reply, payload) => {
    if (/^\/api\/v1\/(?:wallet|payments)(?:[/?]|$)/.test(request.url)) {
      reply.header('Cache-Control', 'no-store')
    }
    return payload
  })
  const user = async (r: FastifyRequest) =>
    (await p.identity.authenticate(bearer(r.headers.authorization))).user.id
  const id = (r: FastifyRequest) => parseId((r.params as { id: string }).id)
  app.get('/api/v1/wallet', async (r) => ({
    data: await p.billing.wallet(await user(r)),
  }))
  app.get('/api/v1/wallet/pricing', async (r) => {
    await user(r)
    return { data: await p.pricing.schedule() }
  })
  app.get('/api/v1/wallet/packages', async (r) => {
    await user(r)
    return { data: await p.billing.catalog.products() }
  })
  app.get('/api/v1/wallet/lots', async (r) => ({
    data: await p.billing.lots(await user(r)),
  }))
  app.get('/api/v1/wallet/refunds', async (r) => ({
    data: await p.refunds.forUser(await user(r)),
  }))
  app.get('/api/v1/wallet/usage', async (r) => ({
    data: await p.billing.records(await user(r)),
  }))
  app.get('/api/v1/wallet/entries', async (r) => ({
    data: await p.billing.entries(await user(r)),
  }))
  app.get('/api/v1/payments/capabilities', async (r) => {
    await user(r)
    return { data: await p.payments.capabilities() }
  })
  app.get('/api/v1/payments/orders', async (r) => ({
    data: await p.payments.list(await user(r)),
  }))
  app.get('/api/v1/payments/orders/:id', async (r) => ({
    data: await p.payments.get(await user(r), id(r)),
  }))
  app.post('/api/v1/payments/orders', async (r, reply) => {
    const uid = await user(r)
    const body = object(r.body, ['packageId', 'version'])
    return reply.code(201).send({
      data: await p.payments.create(
        uid,
        body,
        requestKey(r.headers['idempotency-key']),
      ),
    })
  })
  app.post('/api/v1/payments/orders/:id/intent', async (r) => {
    const input = object(r.body ?? {}, ['mode'])
    return {
      data: await p.payments.intent(
        await user(r),
        id(r),
        input.mode as import('@t-box/shared').WechatPaymentMode | undefined,
        r.ip,
      ),
    }
  })
  app.post('/api/v1/payments/orders/:id/refresh', async (r) => ({
    data: await p.payments.refresh(await user(r), id(r)),
  }))
  if (p.wechatAuthorization) {
    app.get('/api/v1/payments/wechat/oauth/callback', async (r, reply) => {
      const q = r.query as { state?: unknown, code?: unknown }
      reply
        .header('Cache-Control', 'no-store')
        .header('Referrer-Policy', 'no-referrer')
      return reply.redirect(
        await p.wechatAuthorization!.callback(q.state, q.code),
      )
    })
  }
  app.delete('/api/v1/payments/orders/:id', async (r) => ({
    data: await p.payments.close(await user(r), id(r)),
  }))
  // Signature verification needs the exact bytes, before JSON parsing. The parser
  // is scoped to this route; it cannot change ordinary REST body parsing.
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json')
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 64 * 1024 },
      (_req, body, done) => done(null, body),
    )
    scope.post('/api/v1/payments/webhooks/wechat', async (r) => {
      await p.payments.notify(r.body as Buffer, r.headers)
      return { code: 'SUCCESS', message: '成功' }
    })
    scope.post('/api/v1/payments/webhooks/wechat/refunds', async (r) => {
      await p.refunds.notify(r.body as Buffer, r.headers)
      return { code: 'SUCCESS', message: '成功' }
    })
  })
  app.addHook('onReady', async () => {
    await p.billing.recover()
  })
}
