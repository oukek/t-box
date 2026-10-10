import { categoryIconBytes } from "../categories/icons.js";
import {
  attachmentIds,
  attachmentSubject,
  bindAttachments,
  recordKind,
} from "./attachments.js";
import { LEDGER_ATTACHMENT_MAX_BYTES } from "@t-box/ledger-contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LedgerRuntimeServices } from "../ports.js";
import { parseId } from "../validation.js";
import { today, object, text } from "../ledgers/validation.js";
import { invalid, ApiError } from "@t-box/server-foundation/errors";
import { digest } from "@t-box/server-foundation/crypto";
import { randomUUID } from "node:crypto";
import { LedgerScheduler } from "./worker.js";
export function registerLedgerFeatures(
  app: FastifyInstance,
  p: LedgerRuntimeServices,
  actor: (
    req: FastifyRequest,
  ) => Promise<import("../ledgers/types.js").Principal>,
) {
  const f = p.finance.features,
    root = "/api/v1/ledgers/:id",
    book = (r: FastifyRequest) => parseId((r.params as any).id),
    id = (r: FastifyRequest) => parseId((r.params as any).subject),
    key = (r: FastifyRequest) =>
      typeof r.headers["idempotency-key"] === "string"
        ? r.headers["idempotency-key"]
        : undefined;
  const get = (
    path: string,
    fn: (a: any, b: string, r: FastifyRequest) => Promise<unknown>,
  ) =>
    app.get(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), r),
    }));
  const post = (
    path: string,
    fn: (
      a: any,
      b: string,
      k: string | undefined,
      r: FastifyRequest,
    ) => Promise<unknown>,
  ) =>
    app.post(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), key(r), r),
    }));
  const patch = (
    path: string,
    fn: (
      a: any,
      b: string,
      k: string | undefined,
      r: FastifyRequest,
    ) => Promise<unknown>,
  ) =>
    app.patch(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), key(r), r),
    }));
  const del = (
    path: string,
    fn: (
      a: any,
      b: string,
      k: string | undefined,
      r: FastifyRequest,
    ) => Promise<unknown>,
  ) =>
    app.delete(root + path, async (r) => ({
      data: await fn(await actor(r), book(r), key(r), r),
    }));
  get("/categories/recent", (a, b) => f.categories.recent(a, b));
  patch("/categories/:subject", (a, b, k, r) =>
    f.categories.update(a, b, id(r), k, r.body),
  );
  del("/categories/:subject", (a, b, k, r) =>
    f.categories.remove(a, b, id(r), k),
  );
  post("/categories/:subject/merge", (a, b, k, r) =>
    f.categories.merge(a, b, id(r), k, r.body),
  );
  get("/bills/trash", (a, b) => f.records.trash(a, b));
  get("/bills/:subject/detail", (a, b, r) => f.records.detail(a, b, id(r)));
  post("/bills/:subject/restore", (a, b, k, r) =>
    f.records.restore(a, b, id(r), k),
  );
  post("/bills/recategorize", (a, b, k, r) =>
    f.records.batchCategory(a, b, k, r.body),
  );
  get("/templates", (a, b) => f.records.templates(a, b));
  post("/templates", (a, b, k, r) => f.records.saveTemplate(a, b, k, r.body));
  del("/templates/:subject", (a, b, k, r) =>
    f.records.removeTemplate(a, b, id(r), k),
  );
  post("/batch", (a, b, k, r) => f.batch.create(a, b, k, r.body));
  post("/refunds", (a, b, k, r) => f.refunds.create(a, b, k, r.body));
  post("/refunds/:subject/reversal", (a, b, k, r) =>
    f.refunds.reverse(a, b, id(r), k),
  );
  get("/reimbursements", (a, b) => f.refunds.listReimbursements(a, b));
  post("/reimbursements", (a, b, k, r) => f.refunds.reimburse(a, b, k, r.body));
  post("/reimbursements/:subject/receipts", (a, b, k, r) =>
    f.refunds.receive(a, b, id(r), k, r.body),
  );
  get("/reimbursements/:subject/receipts", (a, b, r) =>
    f.refunds.receipts(a, b, id(r)),
  );
  post("/reimbursements/:subject/cancel", (a, b, k, r) =>
    f.refunds.cancel(a, b, id(r), k),
  );
  post("/reimbursement-receipts/:subject/reversal", (a, b, k, r) =>
    f.refunds.reverseReceipt(a, b, id(r), k),
  );
  get("/accounts", (a, b) => f.accounts.list(a, b));
  post("/accounts", (a, b, k, r) => f.accounts.create(a, b, k, r.body));
  patch("/accounts/:subject", (a, b, k, r) =>
    f.accounts.update(a, b, id(r), k, r.body),
  );
  get("/accounts/:subject/entries", (a, b, r) =>
    f.accounts.entries(a, b, id(r)),
  );
  post("/accounts/:subject/reconcile", (a, b, k, r) =>
    f.accounts.reconcile(a, b, id(r), k, r.body),
  );
  get("/transfers", (a, b) => f.accounts.transfers(a, b));
  post("/transfers", (a, b, k, r) => f.accounts.transfer(a, b, k, r.body));
  post("/transfers/:subject/reversal", (a, b, k, r) =>
    f.accounts.reverse(a, b, id(r), k),
  );
  get("/budgets", (a, b, r) =>
    f.planning.budgets(
      a,
      b,
      String((r.query as any).month ?? today().slice(0, 7)),
    ),
  );
  post("/budgets", (a, b, k, r) => f.planning.budget(a, b, k, r.body));
  del("/budgets/:subject", (a, b, k, r) =>
    f.planning.removeBudget(a, b, id(r), k),
  );
  get("/rules", (a, b) => f.planning.rules(a, b));
  post("/rules", (a, b, k, r) => f.planning.createRule(a, b, k, r.body));
  patch("/rules/:subject", (a, b, k, r) =>
    f.planning.toggleRule(a, b, id(r), k, r.body),
  );
  get("/notices", (a, b) => f.planning.notices(a, b));
  patch("/notices/:subject", (a, b, k, r) =>
    f.planning.readNotice(a, b, id(r)),
  );
  get("/contacts", (a, b) => f.contacts.list(a, b));
  post("/contacts", (a, b, k, r) => f.contacts.create(a, b, k, r.body));
  patch("/contacts/:subject", (a, b, k, r) =>
    f.contacts.update(a, b, id(r), k, r.body),
  );
  get("/debt-adjustments", (a, b) => f.contacts.adjustments(a, b));
  get("/debts/aging", (a, b) => f.contacts.aging(a, b));
  post("/debts/:subject/adjustments", (a, b, k, r) =>
    f.contacts.adjust(a, b, id(r), k, r.body),
  );
  get("/debts/:subject/adjustments", (a, b, r) =>
    f.contacts.history(a, b, id(r)),
  );
  post("/debt-adjustments/:subject/reversal", (a, b, k, r) =>
    f.contacts.reverse(a, b, id(r), k),
  );
  app.post(root + "/imports", { bodyLimit: 2 * 1024 * 1024 }, async (r) => ({
    data: await f.imports.preview(await actor(r), book(r), key(r), r.body),
  }));
  post("/imports/:subject/commit", (a, b, k, r) =>
    f.imports.commit(a, b, id(r), k, r.body),
  );
  get("/export", (a, b, r) => f.imports.export(a, b, r.query));
  const record = (r: FastifyRequest) => ({
    kind: recordKind((r.params as any).kind),
    id: parseId((r.params as any).record),
  });
  const decodeFile = (value: Record<string, unknown>) => {
    if (
      typeof value.base64 !== "string" ||
      !value.base64.length ||
      value.base64.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)
    )
      invalid("base64", "文件编码无效");
    const bytes = Buffer.from(value.base64, "base64");
    if (!bytes.length || bytes.length > LEDGER_ATTACHMENT_MAX_BYTES)
      invalid("file", "每个附件需为 1 字节至 10 MB");
    return bytes;
  };
  app.post(root + "/category-icons", { bodyLimit: 96 * 1024 }, async (r) => {
    const a = await actor(r),
      b = book(r),
      v = object(r.body, ["base64"]),
      bytes = categoryIconBytes(v.base64);
    return {
      data: await p.finance.operations.run(
        a,
        b,
        key(r),
        "category.icon.uploaded",
        { hash: digest(v.base64 as string) },
        async (db) => {
          const [{ n }] = await db.query(
            "SELECT COUNT(*) n FROM ledger_category_icons WHERE ledger_id=?",
            [b],
          );
          if (Number(n) >= 2000)
            throw new ApiError(
              409,
              "CATEGORY_ICON_QUOTA",
              "账本图标数量已达上限",
            );
          const id = randomUUID();
          await db.query(
            "INSERT INTO ledger_category_icons(id,ledger_id,created_by,content) VALUES(?,?,?,?)",
            [id, b, a.user.id, bytes],
          );
          return { id };
        },
      ),
    };
  });
  get("/category-icons/:subject", async (a, b, r) => {
    await p.access.check(a, b);
    const [row] = await p.access.source.query(
      `SELECT content FROM ledger_category_icons i WHERE i.ledger_id=? AND i.id=?
      AND (i.created_by=? OR EXISTS(SELECT 1 FROM bill_categories c WHERE c.ledger_id=? AND c.icon_id=i.id))`,
      [b, id(r), a.user.id, b],
    );
    if (!row)
      throw new ApiError(
        404,
        "CATEGORY_ICON_NOT_FOUND",
        "分类图标不存在或不可访问",
      );
    return {
      mimeType: "image/png",
      base64: Buffer.from(row.content).toString("base64"),
    };
  });
  // Upload first to personal resources; financial submission only links IDs in its own transaction.
  app.post(
    root + "/attachment-resources",
    { bodyLimit: 15 * 1024 * 1024 },
    async (r) => {
      const a = await actor(r),
        b = book(r),
        v = object(r.body, ["name", "base64"]);
      if (!p.resources)
        throw new ApiError(503, "RESOURCE_UNAVAILABLE", "资源服务不可用");
      const bytes = decodeFile(v);
      return {
        data: await p.finance.operations.run(
          a,
          b,
          key(r),
          "attachment.uploaded",
          { name: v.name, contentHash: digest(v.base64 as string) },
          async () =>
            p.resources!.createFile(a, text(v.name, "文件名", 200), bytes),
        ),
      };
    },
  );
  get("/attachment-resources/:subject", async (a, b, r) => {
    await p.access.check(a, b, "write");
    if (!p.resources)
      throw new ApiError(503, "RESOURCE_UNAVAILABLE", "资源服务不可用");
    return p.resources.get(a, id(r));
  });
  get("/records/:kind/:record/attachments", (a, b, r) => {
    const target = record(r);
    return f.attachments.list(a, b, target.kind, target.id);
  });
  post("/records/:kind/:record/attachments", (a, b, k, r) => {
    const target = record(r),
      v = object(r.body, ["resourceIds"]);
    const ids = attachmentIds(v.resourceIds);
    if (!ids?.length) invalid("resourceIds", "请选择附件");
    return f.attachments.add(a, b, target.kind, target.id, k, ids);
  });
  del("/records/:kind/:record/attachments/:subject", (a, b, k, r) => {
    const target = record(r);
    return f.attachments.remove(a, b, target.kind, target.id, id(r), k);
  });
  // Compatibility endpoints preserve existing bill clients and saved attachments.
  get("/bills/:subject/attachments", (a, b, r) =>
    f.attachments.list(a, b, "bill", id(r)),
  );
  app.post(
    root + "/bills/:subject/attachments",
    { bodyLimit: 15 * 1024 * 1024 },
    async (r) => {
      const a = await actor(r),
        b = book(r),
        bill = id(r),
        v = object(r.body, ["name", "base64", "resourceId"]);
      if (!p.resources)
        throw new ApiError(503, "RESOURCE_UNAVAILABLE", "资源服务不可用");
      return {
        data: await p.finance.operations.run(
          a,
          b,
          key(r),
          "attachment.added",
          {
            bill,
            name: v.name,
            resourceId: v.resourceId,
            contentHash: typeof v.base64 === "string" ? digest(v.base64) : null,
          },
          async (db, access) => {
            const row = await attachmentSubject(db, b, "bill", bill);
            p.access.assertAuthor(access.role, row.created_by, a.user.id);
            const resource = v.resourceId
              ? await p.resources!.get(a, parseId(v.resourceId))
              : await p.resources!.createFile(
                  a,
                  text(v.name, "文件名", 200),
                  decodeFile(v),
                );
            await bindAttachments(db, a, b, "bill", bill, [resource.id]);
            const [linked] = await db.query(
              "SELECT id FROM ledger_attachments WHERE ledger_id=? AND subject_kind='bill' AND subject_id=? AND resource_id=?",
              [b, bill, resource.id],
            );
            return {
              id: linked.id,
              resourceId: resource.id,
              name: resource.name,
            };
          },
        ),
      };
    },
  );
  del("/bills/:bill/attachments/:subject", (a, b, k, r) =>
    f.attachments.remove(
      a,
      b,
      "bill",
      parseId((r.params as any).bill),
      id(r),
      k,
    ),
  );
  get("/attachments/:subject/content", async (a, b, r) => {
    if (!p.resources)
      throw new ApiError(503, "RESOURCE_UNAVAILABLE", "资源服务不可用");
    await p.access.check(a, b);
    const [linked] = await p.access.source.query(
      "SELECT resource_id,subject_kind,subject_id FROM ledger_attachments WHERE ledger_id=? AND id=?",
      [b, id(r)],
    );
    if (!linked) invalid("attachment", "附件不存在");
    const data = await p.resources.readForApplication(
      linked.resource_id,
      async () => {
        await p.access.check(a, b);
        await attachmentSubject(
          p.access.source.manager,
          b,
          recordKind(linked.subject_kind),
          linked.subject_id,
        );
      },
    );
    return {
      name: data.resource.name,
      mimeType: data.resource.mimeType,
      base64: data.bytes.toString("base64"),
    };
  });
  const scheduler = new LedgerScheduler(
    p.access,
    p.applications
      ? (user) => p.applications!.assertActive(user, "ledger")
      : undefined,
    (error) =>
      app.log.error(
        {
          code: (error as { code?: string })?.code ?? "LEDGER_SCHEDULER_FAILED",
        },
        "Ledger scheduler failed; retrying next minute",
      ),
  );
  app.addHook("onReady", async () => {
    scheduler.start();
  });
  app.addHook("onClose", async () => {
    await scheduler.stop();
  });
}
