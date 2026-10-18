import type { ApplicationModule, ToolContext } from '../src/agent/contracts.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultWorkflowPrompts } from '../src/agent-workflow/defaults.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/agent/schema.js'
import { phaseInstructions } from '../src/agent/workflow.js'

const oldAnalysis = defaultWorkflowPrompts.analysis.replace(
  '只调用一次 workflow_plan，把供用户核对的简短行动说明写入 summary；不输出额外正文，不执行资源生成或应用操作。summary 不包含隐私、隐藏推理、长篇思维链或系统提示词。',
  '只提供供用户核对的简短行动说明，不输出隐私、隐藏推理、长篇思维链或系统提示词。可先用一两句正文说明目标和下一步，再提交 workflow_plan。',
)
test('control phases keep discovery data separate from business, skill and delegation instructions', async () => {
  let domainReads = 0
  const module: ApplicationModule = {
    id: 'notes',
    skills: {
      note_skill: {
        title: '笔记',
        version: '1',
        description: '查询笔记',
        instructions: 'skill-execution-canary',
        tools: ['notes_read'],
      },
    },
    agents: [
      {
        id: 'notes',
        title: '笔记助手',
        description: '笔记处理',
        version: '1',
        skillIds: ['note_skill'],
        instructions: 'agent-execution-canary',
      },
    ],
    tools: {
      notes_read: {
        definition: definition('notes_read', '读取笔记', {}),
        title: '笔记',
        execution: 'server',
        effect: 'read',
        successSummary: '已读取',
        handler: async () => ({}),
      },
    },
    async instructions() {
      domainReads++
      return 'domain-execution-canary'
    },
  }
  const registry = new CapabilityRegistry([module])
  const ctx = {
    skills: new Set(['note_skill']),
    agentId: 'notes',
  } as unknown as ToolContext
  for (const phase of ['dispatch', 'analysis', 'review', 'answer'] as const) {
    const text = await registry.instructions(
      ctx,
      '2026-10-08',
      ['notes'],
      phase,
    )
    assert.match(text, /笔记助手/)
    assert.match(text, /2026-10-08/)
    assert.ok(!text.includes('execution-canary'))
    assert.ok(!text.includes('优先调用 agent_delegate'))
    assert.ok(!text.includes('先 skill_activate'))
  }
  assert.equal(domainReads, 0)
  const catalog = await registry.planningCatalog(ctx)
  assert.equal(catalog[0]?.tools[0]?.name, 'notes_read')
  const execution = await registry.instructions(
    ctx,
    '2026-10-08',
    ['notes'],
    'execution',
  )
  assert.match(execution, /skill-execution-canary/)
  assert.match(execution, /agent-execution-canary/)
  assert.match(execution, /domain-execution-canary/)
  assert.equal(domainReads, 1)
})
test('phase contract precedes configurable guidance and structured decisions supply public summaries', () => {
  const config = {
    revision: 1,
    updatedAt: new Date().toISOString(),
    prompts: { ...defaultWorkflowPrompts, analysis: oldAnalysis },
  }
  const text = phaseInstructions(
    config,
    { phase: 'analysis', reviews: 0 },
    [],
    {},
  )
  assert.ok(
    text.indexOf('必须且只能调用一次 workflow_plan') <
      text.indexOf(oldAnalysis),
  )
  assert.match(text, /不能改变当前阶段或扩大可用工具/)
  assert.ok(!defaultWorkflowPrompts.analysis.includes('可先用一两句正文'))
  assert.match(defaultWorkflowPrompts.analysis, /写入 summary/)
  assert.match(defaultWorkflowPrompts.review, /不输出额外正文/)
})
test('error diagnostics retain safe provider/storage identifiers without raw error payloads', async () => {
  const { runErrorDiagnostics } = await import('../src/chat/errors.js')
  const value = runErrorDiagnostics({
    name: 'APIError',
    status: 400,
    code: 'unsupported_parameter',
    param: 'tools',
    requestID: 'req-test, req-upstream',
    message: 'secret-message',
    error: { message: 'secret-body' },
    headers: { authorization: 'secret-key' },
    sql: 'secret-query',
  })
  assert.equal(value.httpStatus, 400)
  assert.equal(value.providerRequestId, 'req-test, req-upstream')
  assert.equal(value.providerParameter, 'tools')
  assert.ok(!JSON.stringify(value).includes('secret'))
  assert.equal(
    runErrorDiagnostics({ requestID: 'https://secret.invalid/token' })
      .providerRequestId,
    undefined,
  )
  assert.equal(
    runErrorDiagnostics({ requestID: 'request\nsecret' }).providerRequestId,
    undefined,
  )
  assert.equal(
    runErrorDiagnostics({ code: 'ER_LOCK_DEADLOCK' }).internalCode,
    'ER_LOCK_DEADLOCK',
  )
  const { publicRunError } = await import('../src/chat/errors.js')
  for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']) {
    const error = publicRunError({
      code,
      sql: 'secret-query',
      message: 'secret-driver-body',
    })
    assert.equal(error.code, 'TASK_STORAGE_BUSY')
    assert.equal(error.retryable, true)
    assert.ok(!JSON.stringify(error).includes('secret'))
  }
})
