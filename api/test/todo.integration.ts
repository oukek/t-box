import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  manifest,
  newItem,
  occurs,
  period,
  seriesAt,
} from '@t-box/todo-contracts'
import { todoSchema, TodoService } from '@t-box/todo-server'
import mysql from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { extendDatabase } from '../src/db/extensions.js'
import { assertDisposableDatabase } from './fixtures.js'

const dbName = 't_box_test_todo_' + randomUUID().replaceAll('-', '')
assertDisposableDatabase(dbName)
const { database: _default, ...settings } = getConfig().mysql
const conn = await mysql.createConnection(settings)
await conn.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [dbName])
const source = createDataSource({ ...settings, database: dbName })
try {
  await source.initialize()
  const runner = source.createQueryRunner()
  try {
    await runner.connect()
    assert.equal(await extendDatabase(runner, [todoSchema]), 1)
    assert.equal(await extendDatabase(runner, [todoSchema]), 0)
  } finally {
    await runner.release()
  }
  const api = new TodoService(source).backend()
  const context = {
    appId: manifest.id,
    subject: 'a'.repeat(64),
    generation: 1,
    releaseId: 'todo-1',
  }
  const install = {
    ...context,
    action: 'install' as const,
    operationId: randomUUID(),
  }
  const receipt = await api.lifecycle(install)
  assert.deepEqual(await api.operation(install), receipt)
  const invoke = (
    method: string,
    args: unknown,
    actionId = randomUUID(),
    subject = context.subject,
  ) =>
    api.invoke({
      ...context,
      subject,
      method,
      arguments: args,
      invocationId: actionId,
    })
  const list = newItem('list', '2026-11-23')
  list.title = '每两周家务'
  list.rule = {
    unit: 'week',
    interval: 2,
    weekdays: [1, 5],
    lastDay: false,
    zone: 'Asia/Shanghai',
  }
  list.steps = [{ id: randomUUID(), title: '擦隔板', done: '', date: '' }]
  assert.equal(occurs(list, '2026-11-27'), true)
  assert.equal(occurs(list, '2026-11-30'), false)
  assert.equal(occurs(list, '2026-12-07'), true)
  const month = {
    ...list,
    date: '2026-01-31',
    rule: { ...list.rule, unit: 'month' as const, interval: 1 },
  }
  assert.ok(occurs(month, '2026-02-28'))
  assert.ok(occurs(month, '2026-03-31'))
  const key = randomUUID()
  const args = { item: list, revision: 0 }
  const result = await invoke('save', args, key)
  assert.deepEqual(await invoke('save', args, key), result)
  const first = period(list, '2026-11-23')
  first.steps[0]!.done = new Date().toISOString()
  first.done = first.steps[0]!.done
  await invoke('save', { item: first, revision: 0, seriesRevision: 1 })
  assert.equal(period(list, '2026-11-27').steps[0]!.done, '')
  const changes = await Promise.allSettled(
    ['A', 'B'].map((title) =>
      invoke('save', { item: { ...list, title }, revision: 1 }),
    ),
  )
  assert.equal(changes.filter((r) => r.status === 'fulfilled').length, 1)
  const page = (await invoke('list', {})) as {
    rows: import('@t-box/todo-contracts').Saved[]
    version: number
  }
  assert.equal(page.rows.filter((r) => !r.until).length, 2)
  assert.equal(
    seriesAt(
      list,
      page.rows.filter((r) => r.until),
      '2026-01-01',
    ).title,
    list.title,
  )
  const other = 'b'.repeat(64)
  await api.lifecycle({
    ...install,
    operationId: randomUUID(),
    subject: other,
  })
  assert.deepEqual(
    ((await invoke('list', {}, randomUUID(), other)) as { rows: unknown[] })
      .rows,
    [],
  )
  await assert.rejects(
    invoke(
      'save',
      { item: first, revision: 0, seriesRevision: 1 },
      randomUUID(),
      other,
    ),
  )
  const plan = newItem('plan')
  plan.title = '搬家'
  await invoke('save', { item: plan, revision: 0 })
  await assert.rejects(invoke('list', { version: page.version }), {
    code: 'TODO_CONFLICT',
  })
  await api.lifecycle({
    ...install,
    action: 'uninstall',
    operationId: randomUUID(),
  })
  await assert.rejects(invoke('list', {}), { code: 'TODO_INSTALLATION' })
  console.log(
    'Todo MySQL checks passed: schema, recurrence, account isolation, retry, concurrent edits, snapshots and uninstall fencing.',
  )
} finally {
  if (source.isInitialized) {
    await source.destroy()
  }
  await conn.query('DROP DATABASE ??', [dbName])
  await conn.end()
}
