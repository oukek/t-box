import type { FastifyInstance } from 'fastify'
import { bearer } from '@t-box/server-foundation/auth'
import { calculatorCatalog } from '@t-box/shared'
import { runRestCalculation } from './rest-calculation.js'

export function registerCalculator(
  app: FastifyInstance,
  authenticate: (token: string) => Promise<unknown>,
) {
  app.get('/api/v1/calculator/types', async (req, reply) => {
    await authenticate(bearer(req.headers.authorization))
    reply.header('Cache-Control', 'no-store')
    return { data: calculatorCatalog }
  })
  app.post('/api/v1/calculator/calculations', async (req, reply) => {
    await authenticate(bearer(req.headers.authorization))
    reply.header('Cache-Control', 'no-store')
    return { data: runRestCalculation(req.body) }
  })
}
