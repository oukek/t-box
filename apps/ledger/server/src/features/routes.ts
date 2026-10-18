import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Principal } from '../ledgers/types.js'
import type { LedgerRuntimeServices } from '../ports.js'
import { randomUUID } from 'node:crypto'
import { LEDGER_ATTACHMENT_MAX_BYTES } from '@t-box/ledger-contracts'
import { digest } from '@t-box/server-foundation/crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { categoryIconBytes } from '../categories/icons.js'
import { ErrorCode } from '../error-codes.js'
import { object, text, today } from '../ledgers/validation.js'
import { LedgerAttachmentEntity } from '../persistence/attachments-entities.js'
import { LedgerCategoryIconEntity } from '../persistence/categories-entities.js'
import { parseId } from '../validation.js'
import {
  attachmentIds,
  attachmentSubject,
  bindAttachments,
  recordKind,
} from './attachments.js'
import { LedgerScheduler } from './worker.js'

export function registerLedgerFeatures(
  app: FastifyInstance,
  p: LedgerRuntimeServices,
  actor: (req: FastifyRequest) => Promise<Principal>,
) {
  const f = p.finance.features
  const root = '/api/v1/ledgers/:id'
  const params = (r: FastifyRequest) =>
    object(r.params, ['id', 'subject', 'kind', 'record', 'bill'])
  const book = (r: FastifyRequest) => parseId(params(r).id)
  const id = (r: FastifyRequest) => parseId(params(r).subject)
  const key = (r: FastifyRequest) =>
    typeof r.headers['idempotency-key'] === 'string'
      ? r.headers['idempotency-key']
      : undefined
  const get = (
    path: string,
    fn: (a: Principal, b: string, r: FastifyRequest) => Promise<unknown>,
  ) =>
    app.get(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), r),
    }))
  const post = (
    path: string,
    fn: (
      a: Principal,
      b: string,
      k: string | undefined,
      r: FastifyRequest,
    ) => Promise<unknown>,
  ) =>
    app.post(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), key(r), r),
    }))
  const patch = (
    path: string,
    fn: (
      a: Principal,
      b: string,
      k: string | undefined,
      r: FastifyRequest,
    ) => Promise<unknown>,
  ) =>
    app.patch(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), key(r), r),
    }))
  const del = (
    path: string,
    fn: (
      a: Principal,
      b: string,
      k: string | undefined,
      r: FastifyRequest,
    ) => Promise<unknown>,
  ) =>
    app.delete(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), key(r), r),
    }))
  get('/categories/recent', (a, b) => f.categories.recent(a, b))
  patch('/categories/:subject', (a, b, k, r) =>
    f.categories.update(a, b, id(r), k, r.body))
  del('/categories/:subject', (a, b, k, r) =>
    f.categories.remove(a, b, id(r), k))
  post('/categories/:subject/merge', (a, b, k, r) =>
    f.categories.merge(a, b, id(r), k, r.body))
  get('/bills/trash', (a, b) => f.records.trash(a, b))
  get('/bills/:subject/detail', (a, b, r) => f.records.detail(a, b, id(r)))
  post('/bills/:subject/restore', (a, b, k, r) =>
    f.records.restore(a, b, id(r), k))
  post('/bills/recategorize', (a, b, k, r) =>
    f.records.batchCategory(a, b, k, r.body))
  get('/templates', (a, b) => f.records.templates(a, b))
  post('/templates', (a, b, k, r) => f.records.saveTemplate(a, b, k, r.body))
  del('/templates/:subject', (a, b, k, r) =>
    f.records.removeTemplate(a, b, id(r), k))
  post('/batch', (a, b, k, r) => f.batch.create(a, b, k, r.body))
  post('/refunds', (a, b, k, r) => f.refunds.create(a, b, k, r.body))
  post('/refunds/:subject/reversal', (a, b, k, r) =>
    f.refunds.reverse(a, b, id(r), k))
  get('/reimbursements', (a, b) => f.refunds.listReimbursements(a, b))
  post('/reimbursements', (a, b, k, r) => f.refunds.reimburse(a, b, k, r.body))
  post('/reimbursements/:subject/receipts', (a, b, k, r) =>
    f.refunds.receive(a, b, id(r), k, r.body))
  get('/reimbursements/:subject/receipts', (a, b, r) =>
    f.refunds.receipts(a, b, id(r)))
  post('/reimbursements/:subject/cancel', (a, b, k, r) =>
    f.refunds.cancel(a, b, id(r), k))
  post('/reimbursement-receipts/:subject/reversal', (a, b, k, r) =>
    f.refunds.reverseReceipt(a, b, id(r), k))
  get('/accounts', (a, b) => f.accounts.list(a, b))
  post('/accounts', (a, b, k, r) => f.accounts.create(a, b, k, r.body))
  patch('/accounts/:subject', (a, b, k, r) =>
    f.accounts.update(a, b, id(r), k, r.body))
  get('/accounts/:subject/entries', (a, b, r) =>
    f.accounts.entries(a, b, id(r)))
  post('/accounts/:subject/reconcile', (a, b, k, r) =>
    f.accounts.reconcile(a, b, id(r), k, r.body))
  get('/transfers', (a, b) => f.accounts.transfers(a, b))
  post('/transfers', (a, b, k, r) => f.accounts.transfer(a, b, k, r.body))
  post('/transfers/:subject/reversal', (a, b, k, r) =>
    f.accounts.reverse(a, b, id(r), k))
  get('/budgets', (a, b, r) =>
    f.planning.budgets(
      a,
      b,
      String(object(r.query, ['month']).month ?? today().slice(0, 7)),
    ))
  post('/budgets', (a, b, k, r) => f.planning.budget(a, b, k, r.body))
  del('/budgets/:subject', (a, b, k, r) =>
    f.planning.removeBudget(a, b, id(r), k))
  get('/rules', (a, b) => f.planning.rules(a, b))
  post('/rules', (a, b, k, r) => f.planning.createRule(a, b, k, r.body))
  patch('/rules/:subject', (a, b, k, r) =>
    f.planning.toggleRule(a, b, id(r), k, r.body))
  get('/notices', (a, b) => f.planning.notices(a, b))
  patch('/notices/:subject', (a, b, k, r) => f.planning.readNotice(a, b, id(r)))
  get('/contacts', (a, b) => f.contacts.list(a, b))
  post('/contacts', (a, b, k, r) => f.contacts.create(a, b, k, r.body))
  patch('/contacts/:subject', (a, b, k, r) =>
    f.contacts.update(a, b, id(r), k, r.body))
  get('/debt-adjustments', (a, b) => f.contacts.adjustments(a, b))
  get('/debts/aging', (a, b) => f.contacts.aging(a, b))
  post('/debts/:subject/adjustments', (a, b, k, r) =>
    f.contacts.adjust(a, b, id(r), k, r.body))
  get('/debts/:subject/adjustments', (a, b, r) =>
    f.contacts.history(a, b, id(r)))
  post('/debt-adjustments/:subject/reversal', (a, b, k, r) =>
    f.contacts.reverse(a, b, id(r), k))
  app.post(root + '/imports', { bodyLimit: 2 * 1024 * 1024 }, async (r) => ({
    data: await f.imports.preview(await actor(r), book(r), key(r), r.body),
  }))
  post('/imports/:subject/commit', (a, b, k, r) =>
    f.imports.commit(a, b, id(r), k, r.body))
  get('/export', (a, b, r) => f.imports.export(a, b, r.query))
  const record = (r: FastifyRequest) => ({
    kind: recordKind(params(r).kind),
    id: parseId(params(r).record),
  })
  const decodeFile = (value: Record<string, unknown>) => {
    if (
      typeof value.base64 !== 'string' ||
      !value.base64.length ||
      value.base64.length % 4 ||
      !/^[A-Z0-9+/]*={0,2}$/i.test(value.base64)
    ) {
      invalid('base64', '文件编码无效')
    }
    const bytes = Buffer.from(value.base64, 'base64')
    if (!bytes.length || bytes.length > LEDGER_ATTACHMENT_MAX_BYTES) {
      invalid('file', '每个附件需为 1 字节至 10 MB')
    }
    return bytes
  }
  app.post(root + '/category-icons', { bodyLimit: 96 * 1024 }, async (r) => {
    const a = await actor(r)
    const b = book(r)
    const v = object(r.body, ['base64'])
    const bytes = categoryIconBytes(v.base64)
    if (!p.resources) {
      throw ErrorCode.RESOURCE_UNAVAILABLE()
    }
    await p.access.check(a, b, 'write')
    p.finance.operations.validateKey(key(r))
    const stagedId = randomUUID()
    // Upload before acquiring the financial transaction's ledger lock.
    const location = await p.resources.writeApplicationAsset(stagedId, bytes, {
      name: '分类图标.png',
      mimeType: 'image/png',
    })
    try {
      const data = await p.finance.operations.run(
        a,
        b,
        key(r),
        'category.icon.uploaded',
        { hash: digest(v.base64 as string) },
        async (db) => {
          const count = await db
            .getRepository(LedgerCategoryIconEntity)
            .count({ where: { ledger_id: b } })
          if (count >= 2000) {
            throw ErrorCode.CATEGORY_ICON_QUOTA()
          }
          await db.getRepository(LedgerCategoryIconEntity).insert({
            id: stagedId,
            ledger_id: b,
            created_by: a.user.id,
            object_path: location.path,
            storage_backend: location.storageBackend,
          })
          return { id: stagedId }
        },
      )
      if (data.id !== stagedId) {
        await p.resources.removeApplicationAsset(location).catch(() => {})
      }
      return { data }
    } catch (error) {
      // An unknown COMMIT outcome must never delete a committed icon. If the
      // database is unavailable, retain the staged object for later cleanup.
      const retained = await p.access.source
        .getRepository(LedgerCategoryIconEntity)
        .existsBy({ id: stagedId })
        .catch(() => true)
      if (!retained) {
        await p.resources.removeApplicationAsset(location).catch(() => {})
      }
      throw error
    }
  })
  get('/category-icons/:subject', async (a, b, r) => {
    await p.access.check(a, b)
    const [row] = await p.access.source
      .createQueryBuilder()
      .select('content,object_path AS path,storage_backend AS storageBackend')
      .from('ledger_category_icons', 'i')
      .where(
        'i.ledger_id=:p0 AND i.id=:p1\n      AND (i.created_by=:p2 OR EXISTS(SELECT 1 FROM bill_categories c WHERE c.ledger_id=:p3 AND c.icon_id=i.id))',
      )
      .setParameters({ p0: b, p1: id(r), p2: a.user.id, p3: b })
      .getRawMany()
    if (!row) {
      throw ErrorCode.CATEGORY_ICON_NOT_FOUND('分类图标不存在或不可访问')
    }
    if (row.path && !p.resources) {
      throw ErrorCode.RESOURCE_UNAVAILABLE()
    }
    const bytes = row.path
      ? await p.resources!.readApplicationAsset(row)
      : Buffer.from(row.content)
    return {
      mimeType: 'image/png',
      base64: bytes.toString('base64'),
    }
  })
  // Upload first to personal resources; financial submission only links IDs in its own transaction.
  app.post(
    root + '/attachment-resources',
    { bodyLimit: 15 * 1024 * 1024 },
    async (r) => {
      const a = await actor(r)
      const b = book(r)
      const v = object(r.body, ['name', 'base64'])
      if (!p.resources) {
        throw ErrorCode.RESOURCE_UNAVAILABLE()
      }
      const bytes = decodeFile(v)
      await p.access.check(a, b, 'write')
      p.finance.operations.validateKey(key(r))
      const resource = await p.resources.createFile(
        a,
        text(v.name, '文件名', 200),
        bytes,
      )
      // Personal uploads are durable independently of a financial submission.
      // A failed submission retains its file in My Resources for reuse.
      const data = await p.finance.operations.run(
        a,
        b,
        key(r),
        'attachment.uploaded',
        { name: v.name, contentHash: digest(v.base64 as string) },
        async () => resource,
      )
      if (data.id !== resource.id) {
        await p.resources.remove(a, resource.id).catch(() => {})
      }
      return { data }
    },
  )
  get('/attachment-resources/:subject', async (a, b, r) => {
    await p.access.check(a, b, 'write')
    if (!p.resources) {
      throw ErrorCode.RESOURCE_UNAVAILABLE()
    }
    return p.resources.get(a, id(r))
  })
  get('/records/:kind/:record/attachments', (a, b, r) => {
    const target = record(r)
    return f.attachments.list(a, b, target.kind, target.id)
  })
  post('/records/:kind/:record/attachments', (a, b, k, r) => {
    const target = record(r)
    const v = object(r.body, ['resourceIds'])
    const ids = attachmentIds(v.resourceIds)
    if (!ids?.length) {
      invalid('resourceIds', '请选择附件')
    }
    return f.attachments.add(a, b, target.kind, target.id, k, ids)
  })
  del('/records/:kind/:record/attachments/:subject', (a, b, k, r) => {
    const target = record(r)
    return f.attachments.remove(a, b, target.kind, target.id, id(r), k)
  })
  // Compatibility endpoints preserve existing bill clients and saved attachments.
  get('/bills/:subject/attachments', (a, b, r) =>
    f.attachments.list(a, b, 'bill', id(r)))
  app.post(
    root + '/bills/:subject/attachments',
    { bodyLimit: 15 * 1024 * 1024 },
    async (r) => {
      const a = await actor(r)
      const b = book(r)
      const bill = id(r)
      const v = object(r.body, ['name', 'base64', 'resourceId'])
      if (!p.resources) {
        throw ErrorCode.RESOURCE_UNAVAILABLE()
      }
      const access = await p.access.check(a, b, 'write')
      const subject = await attachmentSubject(
        p.access.source.manager,
        b,
        'bill',
        bill,
      )
      p.access.assertAuthor(access.role, subject.created_by, a.user.id)
      p.finance.operations.validateKey(key(r))
      const resource = v.resourceId
        ? await p.resources.get(a, parseId(v.resourceId))
        : await p.resources.createFile(
            a,
            text(v.name, '文件名', 200),
            decodeFile(v),
          )
      const data = await p.finance.operations.run(
        a,
        b,
        key(r),
        'attachment.added',
        {
          bill,
          name: v.name,
          resourceId: v.resourceId,
          contentHash: typeof v.base64 === 'string' ? digest(v.base64) : null,
        },
        async (db, currentAccess) => {
          const row = await attachmentSubject(db, b, 'bill', bill)
          p.access.assertAuthor(currentAccess.role, row.created_by, a.user.id)
          await bindAttachments(db, a, b, 'bill', bill, [resource.id])
          const linked = await db
            .getRepository(LedgerAttachmentEntity)
            .findOne({
              select: { id: true },
              where: {
                ledger_id: b,
                subject_kind: 'bill',
                subject_id: bill,
                resource_id: resource.id,
              },
            })
          if (!linked) {
            invalid('resource', '附件关联未完成')
          }
          return { id: linked.id, resourceId: resource.id, name: resource.name }
        },
      )
      if (!v.resourceId && data.resourceId !== resource.id) {
        await p.resources.remove(a, resource.id).catch(() => {})
      }
      return { data }
    },
  )
  del('/bills/:bill/attachments/:subject', (a, b, k, r) =>
    f.attachments.remove(a, b, 'bill', parseId(params(r).bill), id(r), k))
  get('/attachments/:subject/content', async (a, b, r) => {
    if (!p.resources) {
      throw ErrorCode.RESOURCE_UNAVAILABLE()
    }
    await p.access.check(a, b)
    const linked = await p.access.source
      .getRepository(LedgerAttachmentEntity)
      .findOne({
        select: { resource_id: true, subject_kind: true, subject_id: true },
        where: { ledger_id: b, id: id(r) },
      })
    if (!linked) {
      invalid('attachment', '附件不存在')
    }
    const data = await p.resources.readForApplication(
      linked.resource_id,
      async () => {
        await p.access.check(a, b)
        await attachmentSubject(
          p.access.source.manager,
          b,
          recordKind(linked.subject_kind),
          linked.subject_id,
        )
      },
    )
    return {
      name: data.resource.name,
      mimeType: data.resource.mimeType,
      base64: data.bytes.toString('base64'),
    }
  })
  const scheduler = new LedgerScheduler(
    p.access,
    p.applications
      ? (user) => p.applications!.assertActive(user, 'ledger')
      : undefined,
    (error) =>
      app.log.error(
        {
          code: (error as { code?: string })?.code ?? 'LEDGER_SCHEDULER_FAILED',
        },
        'Ledger scheduler failed; retrying next minute',
      ),
  )
  app.addHook('onReady', async () => {
    scheduler.start()
  })
  app.addHook('onClose', async () => {
    await scheduler.stop()
  })
}
