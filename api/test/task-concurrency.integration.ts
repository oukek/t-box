import type { ChatServerEvent } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { publicRunError, runErrorDiagnostics } from '../src/chat/errors.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

// Real MySQL leases, first archive inserts and tool receipts, without a paid model.
const source = await createDataSource().initialize()
const users: string[] = []
const services: ApplicationChatService[] = []
try {
  const fixtures = []
  for (let i = 0; i < 24; i++) {
    const platform = new PlatformService(source)
    const login = await platform.identity.register(
      {
        username: `parallel_${randomUUID().replaceAll('-', '')}`,
        password: 'test123',
        nickname: '并发任务测试',
      },
      'task-concurrency-fixture',
    )
    users.push(login.user.id)
    const actor = await platform.identity.authenticate(login.token)
    const book = (await platform.ledgers.list(actor))[0]!
    const [{ id: category }] = await source.query(
      'SELECT id FROM bill_categories WHERE ledger_id=? AND type=\'expense\' LIMIT 1',
      [book.id],
    )
    fixtures.push({ platform, login, actor, book, category })
  }
  const failures: unknown[] = []
  const outcomes = await Promise.allSettled(
    fixtures.map(async ({ platform, login, actor, book, category }) => {
      const events: ChatServerEvent[] = []
      let resolve!: () => void
      const finished = new Promise<void>((done) => {
        resolve = done
      })
      const note = 'parallel-once'
      const service = new ApplicationChatService({
        platform,
        bills: createBillRepository(source),
        onRunError: (error) => failures.push(error),
        provider: {
          mode: 'openai',
          async next(input) {
            const receipts = input.history.filter(
              (item) => item.type === 'function_call_output',
            )
            if (receipts.length < 2) {
              // A new call ID for the same normalized write must reuse its receipt.
              const id = `write-${receipts.length}`
              const args = JSON.stringify({
                type: 'expense',
                amount: receipts.length ? '1.00' : '1',
                category,
                date: '2026-10-08',
                note,
              })
              return {
                calls: [{ id, name: 'bills_create', arguments: args }],
                output: [
                  {
                    type: 'function_call',
                    call_id: id,
                    name: 'bills_create',
                    arguments: args,
                  },
                ],
              }
            }
            input.onDelta('已记录一次')
            return {
              calls: [],
              output: [{ role: 'assistant', content: '已记录一次' }],
            }
          },
        },
      })
      services.push(service)
      const connection = service.connect((event) => {
        events.push(event)
        if (event.type === 'run.finished') {
          resolve()
        }
      })
      await connection.receive({
        type: 'session.open',
        authToken: login.token,
      })
      await connection.receive({
        type: 'message.send',
        requestId: randomUUID(),
        text: '记录支出1元',
        localDate: '2026-10-08',
        applicationIds: ['ledger'],
        scopeBindings: [
          { appId: 'ledger', resourceType: 'book', resourceId: book.id },
        ],
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          finished,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Concurrent task did not finish')),
              30_000,
            )
          }),
        ])
        const final = events.find((event) => event.type === 'run.finished')

        assert.equal(final?.status, 'completed')
        const session = [...service.sessions.all()][0]!
        const task = await platform.tasks.get(actor, session.task!.id)
        assert.equal(task.summary.status, 'completed')
        assert.equal(task.tools.length, 1)
        assert.equal(task.tools[0]?.status, 'completed')
        const bills = await source.query(
          'SELECT id FROM bills WHERE ledger_id=? AND note=?',
          [book.id, note],
        )
        assert.equal(
          bills.length,
          1,
          'parallel admission cannot repeat the normalized write',
        )
        assert.equal(
          await platform.conversations.exists(actor, session.conversationId!),
          true,
        )
      } finally {
        clearTimeout(timer)
        connection.close()
      }
    }),
  )
  if (failures.length) {
    console.error(
      JSON.stringify({ firstFailure: failures[0], count: failures.length }),
    )
  }
  assert.equal(
    failures.length,
    0,
    'no admission, archive or recovery failures',
  )
  for (const result of outcomes) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }
  console.log(
    'PASS: 24 concurrent first conversations complete; archives and leases persist, each normalized bill is written once.',
  )
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'integration failure',
  )
  console.error(
    JSON.stringify({
      error: publicRunError(error),
      diagnostics: runErrorDiagnostics(error),
    }),
  )
  process.exitCode = 1
} finally {
  for (const service of services) {
    await service.close()
  }
  await cleanupUsers(source, users)
  await source.destroy()
}
