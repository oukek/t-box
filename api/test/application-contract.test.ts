import type { ToolContext } from '../src/agent/contracts.js'
import type { ApplicationModule } from '../src/application-sdk/contracts.js'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  APPLICATION_CONTRACT_VERSION,
  ledgerClientInteractions,
} from '@t-box/shared'
import Fastify from 'fastify'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/application-sdk/schema.js'
import { adaptApplication } from '../src/bootstrap/application-adapter.js'
import { createCapabilities } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { registerApplicationCatalog } from '../src/platform/application-catalog.js'

function notesModule(): ApplicationModule {
  return {
    id: 'notes',
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: {
      id: 'notes',
      name: '笔记',
      description: '测试应用',
      version: '1.0',
      icon: 'file',
      color: 'blue',
      skillIds: ['notes_skill'],
    },
    skills: {
      notes_skill: {
        title: '整理笔记',
        description: '查询笔记',
        version: '1',
        tools: ['notes_read'],
        instructions: 'private-skill-canary',
      },
    },
    agents: [
      {
        id: 'notes',
        title: '笔记助手',
        description: '查询',
        version: '1',
        skillIds: ['notes_skill'],
        instructions: 'private-agent-canary',
      },
    ],
    tools: {
      notes_read: {
        definition: definition('notes_read', '读取笔记', {}),
        title: '读取笔记',
        execution: 'server',
        effect: 'read',
        successSummary: '完成',
        handler: async () => {
          throw new Error('catalog must not execute handlers')
        },
      },
    },
  }
}

test('an SDK application receives a restricted context without AI internals or mutable host data', async () => {
  const module = notesModule()
  const session = new MemorySessionRepository().create()
  session.messages = [
    {
      id: 'message',
      role: 'user',
      content: 'private conversation',
      toolCalls: [],
      createdAt: new Date().toISOString(),
    },
  ]
  const registry = new CapabilityRegistry([adaptApplication(module)])
  const context: ToolContext = {
    registry,
    skills: new Set(['notes_skill']),
    session,
    bindings: [
      { appId: 'notes', resourceType: 'note', resourceId: 'original' },
    ],
    requestId: 'fixture',
    signal: new AbortController().signal,
    interact: async () => ({ ok: true, data: { approved: true } }),
    use: async (_key, factory) => factory(),
    configurationSnapshot: {
      revision: 1,
      values: {
        'ai.prompt.assistant': 'host configuration',
        'apps.notes.size': 'legacy',
      },
    },
  }
  let calls = 0
  module.tools.notes_read!.handler = async (_args, appContext) => {
    calls++
    for (const field of [
      'registry',
      'journal',
      'skills',
      'toolAllowlist',
      'configuration',
      'configurationSnapshot',
    ]) {
      assert.equal(field in appContext, false)
    }
    for (const field of ['token', 'history', 'requests', 'calls']) {
      assert.equal(field in appContext.session, false)
    }
    assert.equal('content' in appContext.session.messages[0]!, false)
    ;(appContext.bindings[0] as { resourceId: string }).resourceId = 'changed'
    assert.equal(await appContext.use('one', async () => 'memo'), 'memo')
    return { read: true }
  }
  // Adapt after installing the test handler, exactly as a first-party application is registered.
  const adapted = adaptApplication(module)
  assert.deepEqual(await adapted.tools.notes_read!.handler!({}, context), {
    read: true,
  })
  assert.equal(calls, 1)
  assert.equal(context.bindings[0]!.resourceId, 'original')
})

test('application instructions and tool descriptions cannot be overridden by legacy platform settings', async () => {
  const registry = new CapabilityRegistry([adaptApplication(notesModule())])
  const context: ToolContext = {
    registry,
    skills: new Set(['notes_skill']),
    agentId: 'notes',
    session: new MemorySessionRepository().create(),
    bindings: [],
    requestId: 'fixture',
    signal: new AbortController().signal,
    interact: async () => ({ ok: true, data: {} }),
    use: async (_key, factory) => factory(),
    configurationSnapshot: {
      revision: 1,
      values: {
        'apps.notes.agent.notes': 'legacy-agent-override',
        'apps.notes.skill.notes_skill': 'legacy-skill-override',
        'apps.notes.tool.notes_read': 'legacy-tool-override',
      },
    },
  }
  const instructions = await registry.instructions(context, '2026-10-09', [
    'notes',
  ])
  assert.match(instructions, /private-agent-canary/)
  assert.match(instructions, /private-skill-canary/)
  assert.doesNotMatch(instructions, /legacy-/)
  assert.equal(
    (await registry.planningCatalog(context))[0]!.tools[0]!.description,
    '读取笔记',
  )
  assert.equal(
    (await registry.availableTools(context))[0]!.description,
    '读取笔记',
  )
})

test('catalog derives from actual registrations, excludes prompts and cannot mutate the registry', () => {
  const registry = new CapabilityRegistry([adaptApplication(notesModule())])
  const catalog = registry.capabilities('notes')
  assert.equal(catalog.tools[0]!.name, 'notes_read')
  assert.equal(catalog.contractVersion, APPLICATION_CONTRACT_VERSION)
  assert.equal(catalog.skills[0]!.tools[0], 'notes_read')
  assert.equal(JSON.stringify(catalog).includes('private-'), false)
  assert.equal(JSON.stringify(catalog).includes('handler'), false)
  catalog.tools[0]!.inputSchema.required = ['changed']
  assert.deepEqual(
    registry.tools.notes_read!.definition.parameters.required,
    [],
  )
  assert.throws(() => registry.capabilities('missing'), /应用尚未注册/)
  const ledger = createCapabilities({ bills: {} as any }).capabilities(
    'ledger',
  )
  assert.equal(ledger.tools.length, 27)
  for (const name of [
    'ledger_batch_create',
    'ledger_refund_create',
    'ledger_reimbursement_receive',
    'ledger_import_commit',
    'ledger_attachments_add',
  ]) {
    const tool = ledger.tools.find((entry) => entry.name === name)
    assert.ok(
      tool,
      `${name} must be discoverable through the application contract`,
    )
    assert.equal(tool.execution, 'server')
    assert.equal(tool.effect, 'write')
    assert.equal(tool.confirmation, true)
  }
  const batch = ledger.tools.find(
    (tool) => tool.name === 'ledger_batch_create',
  )!
  const batchProperties = batch.inputSchema.properties as Record<
    string,
    { maxItems?: number }
  >
  assert.equal(batchProperties.items!.maxItems, 100)
  assert.deepEqual(ledger.interactions, ledgerClientInteractions)
  assert.equal(
    ledger.tools.find((tool) => tool.name === 'debts_create')!.confirmation,
    true,
  )
  assert.equal(
    ledger.tools.some((tool) => tool.name === 'finance_confirm'),
    false,
  )
})

test('contract registration rejects unsupported versions and cross-application skill references', () => {
  const module = notesModule()
  assert.throws(
    () =>
      new CapabilityRegistry([
        { ...adaptApplication(module), contractVersion: '2.0' as any },
      ]),
    /Unsupported application contract/,
  )
  const other = {
    ...notesModule(),
    id: 'other',
    manifest: undefined,
    agents: [],
    skills: {},
    tools: {
      other_read: {
        ...module.tools.notes_read!,
        definition: definition('other_read', '读取', {}),
      },
    },
  }
  const cross = notesModule()
  cross.skills.notes_skill!.tools = ['other_read']
  assert.throws(
    () =>
      new CapabilityRegistry([
        adaptApplication(cross),
        adaptApplication(other),
      ]),
    /Skill tools must belong/,
  )
  const wrongManifest = notesModule()
  wrongManifest.manifest = {
    ...wrongManifest.manifest!,
    skillIds: ['other_skill'],
  }
  const foreign = {
    ...other,
    skills: {
      other_skill: { ...module.skills.notes_skill!, tools: ['other_read'] },
    },
  }
  assert.throws(
    () =>
      new CapabilityRegistry([
        adaptApplication(wrongManifest),
        adaptApplication(foreign),
      ]),
    /Manifest skills must belong/,
  )
})

test('catalog HTTP endpoint authenticates before discovery and never executes a tool', async () => {
  const app = Fastify()
  const registry = new CapabilityRegistry([adaptApplication(notesModule())])
  registerApplicationCatalog(app, registry, async (token) => {
    if (token !== 'fixture') {
      throw new ApiError(401, 'UNAUTHENTICATED', '未登录')
    }
  })
  try {
    assert.equal(
      (await app.inject({ url: '/api/v1/applications/notes/capabilities' }))
        .statusCode,
      401,
    )
    const result = await app.inject({
      url: '/api/v1/applications/notes/capabilities',
      headers: { authorization: 'Bearer fixture' },
    })
    assert.equal(result.statusCode, 200)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.json().data.tools[0].name, 'notes_read')
    assert.equal(
      (
        await app.inject({
          url: '/api/v1/applications/missing/capabilities',
          headers: { authorization: 'Bearer fixture' },
        })
      ).statusCode,
      404,
    )
  } finally {
    await app.close()
  }
})

test('application SDK and adapters cannot import AI runtime, provider SDK or transport implementation', async () => {
  for (const folder of [
    '../src/application-sdk',
    '../../packages/app-server-sdk/src',
    '../../apps/ledger/server/src/ai',
    '../../apps/images/server/src',
    '../../apps/calculator/server/src',
    '../../apps/calendar/server/src',
    '../../apps/time/server/src',
    '../../packages/server-foundation/src/persistence',
  ]) {
    for (const name of await readdir(new URL(`${folder}/`, import.meta.url))) {
      if (!name.endsWith('.ts')) {
        continue
      }
      const source = await readFile(
        new URL(`${folder}/${name}`, import.meta.url),
        'utf8',
      )
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1]!,
      )
      assert.ok(
        imports.every(
          (path) => !/openai|\/agent\/|\/chat\/|\/platform\/service/.test(path),
        ),
        `${folder}/${name} imports AI/transport internals`,
      )
    }
  }
})
