import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PlatformService } from './service.js'
import { registerLedger } from '@t-box/ledger-server'
import { deviceLabel } from '../identity/security.js'
import { bearer } from '../identity/service.js'

export function registerPlatform(app: FastifyInstance, p: PlatformService) {
  const principal = (req: FastifyRequest) =>
    p.identity.authenticate(bearer(req.headers.authorization))
  app.get('/api/v1/notifications', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: await p.notifications.list(await principal(req)) }
  })
  app.patch('/api/v1/notifications/read', async (req, reply) => {
    await p.notifications.read(await principal(req))
    return reply.code(204).send()
  })
  app.patch<{ Params: { id: string } }>('/api/v1/notifications/:id/read', async (req, reply) => {
    await p.notifications.read(await principal(req), req.params.id)
    return reply.code(204).send()
  })
  app.post('/api/v1/auth/register', async (req, reply) =>
    reply.code(201).send({ data: await p.identity.register(req.body, req.ip, deviceLabel(req.headers['user-agent'])) }))
  app.post('/api/v1/auth/login', async (req) => ({
    data: await p.identity.login(req.body, req.ip, deviceLabel(req.headers['user-agent'])),
  }))
  app.get('/api/v1/auth/me', async (req) => ({
    data: (await principal(req)).user,
  }))
  app.patch('/api/v1/auth/me', async (req) => ({
    data: await p.identity.updateProfile(await principal(req), req.body),
  }))
  app.delete('/api/v1/auth/session', async (req, reply) => {
    await p.identity.logout(await principal(req))
    return reply.code(204).send()
  })
  app.patch('/api/v1/auth/password', async (req, reply) => {
    await p.identity.changePassword(await principal(req), req.body)
    return reply.code(204).send()
  })
  app.get('/api/v1/auth/sessions', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: await p.accountSecurity.sessions(await principal(req)) }
  })
  app.delete<{ Params: { id: string } }>('/api/v1/auth/sessions/:id', async (req) => ({ data: await p.accountSecurity.revoke(await principal(req), req.params.id) }))
  app.delete('/api/v1/auth/sessions', async (req, reply) => {
    await p.accountSecurity.revokeOthers(await principal(req))
    return reply.code(204).send()
  })
  app.get('/api/v1/auth/recovery-codes', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: await p.accountSecurity.recoveryStatus(await principal(req)) }
  })
  app.post('/api/v1/auth/recovery-codes', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: await p.accountSecurity.generateRecoveryCodes(await principal(req), req.body) }
  })
  app.post('/api/v1/auth/password-recovery', async (req, reply) => {
    await p.accountSecurity.resetPassword(req.body, req.ip)
    return reply.code(204).send()
  })
  registerLedger(app, p)
}
