import type {
  ChatProvider,
  ProviderInput,
  ProviderTurn,
} from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { ApplicationChatService as ChatService } from '../src/bootstrap/chat.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const p = new PlatformService(source)
const users: string[] = []
const input = {
  direction: 'payable',
  counterparty: '测试对象',
  amount: '100',
  date: '2026-01-01',
  dueDate: null,
  note: '确认工具测试',
  cashMovement: true,
}
class FakeProvider implements ChatProvider {
  readonly mode = 'openai'
  index = 0
  async next(_input: ProviderInput): Promise<ProviderTurn> {
    const steps = [
      { name: 'skill_activate', args: { skillId: 'bookkeeping' } },
      { name: 'debts_create', args: input },
      { name: 'debts_create', args: input },
    ]
    const step = steps[this.index++]
    if (!step) {
      return { output: [{ role: 'assistant', content: '结束' }], calls: [] }
    }
    const id = randomUUID()
    const args = JSON.stringify(step.args)
    return {
      output: [
        {
          type: 'function_call',
          call_id: id,
          name: step.name,
          arguments: args,
        },
      ],
      calls: [{ id, name: step.name, arguments: args }],
    }
  }
}
try {
  const user = await p.identity.register(
    {
      username: `consent_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'fixture',
  )
  users.push(user.user.id)
  const actor = await p.identity.authenticate(user.token)
  const book = await p.ledgers.create(actor, {
    name: '确认账本',
    template: 'combined',
  })
  for (const approved of [false, true]) {
    const chat = new ChatService({
      platform: p,
      provider: new FakeProvider(),
      bills: createBillRepository(source),
    })
    let finished: any
    let pending = 0
    let consent: any
    const connection = chat.connect((event) => {
      if (event.type === 'tool.request') {
        pending++
        consent = event
      }
      if (event.type === 'run.finished') {
        finished = event
      }
    })
    await connection.receive({ type: 'session.open', authToken: user.token })
    await connection.receive({
      type: 'message.send',
      requestId: randomUUID(),
      text: '借入测试对象100元',
      localDate: '2026-01-01',
      ledgerId: book.id,
    })
    // eslint-disable-next-line no-unmodified-loop-condition -- The connection callback updates consent during each awaited delay.
    for (let i = 0; i < 200 && !consent; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.equal(consent?.name, 'finance_confirm')
    assert.equal(consent.arguments.ledgerId, book.id)
    assert.equal((await p.finance.debts(actor, book.id, {})).data.length, 0)
    await connection.receive({
      type: 'tool.result',
      runId: consent.runId,
      callId: 'forged',
      result: { ok: true, data: { approved: true } },
    })
    assert.equal((await p.finance.debts(actor, book.id, {})).data.length, 0)
    await connection.receive({
      type: 'tool.result',
      runId: consent.runId,
      callId: consent.callId,
      result: { ok: true, data: { approved } },
    })
    // eslint-disable-next-line no-unmodified-loop-condition -- The connection callback updates finished during each awaited delay.
    for (let i = 0; i < 200 && !finished; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.equal(finished?.status, 'completed')
    assert.equal(pending, 1, '重复工具调用不能重复提示或写入')
    const rows = (await p.finance.debts(actor, book.id, {})).data
    assert.equal(rows.length, approved ? 1 : 0)
    if (approved) {
      assert.equal(rows[0]!.remaining, '100.00')
      assert.equal(
        (
          await p.statistics.get(actor, book.id, {
            period: 'year',
            value: '2026',
          })
        ).income,
        '0.00',
      )
    }
    connection.close()
    await chat.close()
  }
  console.log(
    'PASS: frontend confirmation gates AI debt writes, rejects forged ACK, denial writes nothing, repeated calls are deduplicated.',
  )
} finally {
  await cleanupUsers(source, users)
  await source.destroy()
}
