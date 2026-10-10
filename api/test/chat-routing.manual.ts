import type { ChatServerEvent } from '@t-box/shared'
/** Manual real-model probe through the application runtime; excluded from unit tests. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createVault, loadEncryptionKey } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { publicRunError, runErrorDiagnostics } from '../src/chat/errors.js'
import { invocationContextPolicy } from '../src/chat/invocation-mode.js'
import { createConversationProvider } from '../src/chat/provider-factory.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const mode = process.argv[2] ?? 'current'
if (!['current', 'all', 'responses', 'chat_completions'].includes(mode)) {
  throw new Error(
    'Usage: test:chat-routing [current|all|responses|chat_completions]',
  )
}
const source = await createDataSource().initialize()
const users: string[] = []
const services: ApplicationChatService[] = []
try {
  const configuration = new ConfigurationService(
    new AdminStore(source),
    createVault(loadEncryptionKey()),
  )
  const config = await configuration.runtime()
  assert.ok(config, '请在后台选择普通会话模型')
  const modes =
    mode === 'all'
      ? (['responses', 'chat_completions'] as const)
      : [mode === 'current' ? config.invocationMode : mode]
  for (const api of modes) {
    try {
      assert.ok(api === 'responses' || api === 'chat_completions')
      const platform = new PlatformService(source, configuration)
      const login = await platform.identity.register(
        {
          username: `route_${randomUUID().replaceAll('-', '')}`,
          password: 'test123',
          nickname: '入口验证',
        },
        'routing-probe',
      )
      users.push(login.user.id)
      const raw = createConversationProvider({
        ...config,
        invocationMode: api,
        contextPolicy: invocationContextPolicy(api, config.contextPolicy),
      })
      let calls = 0
      const metered = new MeteredChatProvider(
        raw,
        platform.billing,
        config.billingModelId,
        { inputPrice: '0', outputPrice: '0', imagePrice: '0' },
      )
      const events: ChatServerEvent[] = []
      let resolve!: () => void
      const finished = new Promise<void>((done) => {
        resolve = done
      })
      const service = new ApplicationChatService({
        platform,
        bills: createBillRepository(source),
        workflow: configuration.workflow,
        provider: {
          mode: metered.mode,
          contextPolicy: metered.contextPolicy,
          maxOutputTokens: metered.maxOutputTokens,
          countInputTokens: metered.countInputTokens.bind(metered),
          summarize: metered.summarize.bind(metered),
          compact: metered.compact.bind(metered),
          // Title generation is deliberately omitted; this probe counts response calls.
          async next(input) {
            calls++
            return metered.next(input)
          },
        },
        onRunError: (error) =>
          console.error(JSON.stringify({ api, failure: error })),
      })
      services.push(service)
      const connection = service.connect((event) => {
        events.push(event)
        if (event.type === 'run.finished') {
          resolve()
        }
      })
      const start = Date.now()
      await connection.receive({
        type: 'session.open',
        authToken: login.token,
      })
      await connection.receive({
        type: 'message.send',
        requestId: randomUUID(),
        text: '1+1=多少',
        localDate: '2026-10-08',
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          finished,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Probe timed out')),
              180_000,
            )
          }),
        ])
        const final = events.find(
          (event) => event.type === 'run.finished',
        ) as Extract<ChatServerEvent, { type: 'run.finished' }>
        const message = final.snapshot.messages.at(-1)!
        console.log(
          JSON.stringify({
            api,
            status: final.status,
            responseCalls: calls,
            answer: message.content,
            timelineKinds: message.timeline?.map((item) => item.kind),
            durationMs: Date.now() - start,
          }),
        )
        assert.equal(final.status, 'completed')
        assert.equal(calls, 1, '简单问题应在首次模型请求中完成')
        assert.ok(message.content.includes('2'))
        assert.ok(message.timeline?.every((item) => item.kind === 'answer'))
        assert.equal(
          message.timeline?.length,
          1,
          '流式内容与完成内容不能重复显示',
        )
      } finally {
        clearTimeout(timer)
        connection.close()
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          api,
          error: publicRunError(error),
          diagnostics: runErrorDiagnostics(error),
        }),
      )
      process.exitCode = 1
    }
  }
} catch (error) {
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
