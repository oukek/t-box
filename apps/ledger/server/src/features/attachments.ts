import { attachmentIds } from "./attachment-input.js";
export { attachmentIds } from "./attachment-input.js";
import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import {
  ledgerRecordKinds,
  LEDGER_ATTACHMENT_LIMIT,
  LEDGER_ATTACHMENT_MAX_BYTES,
  type LedgerRecordKind,
} from "@t-box/ledger-contracts";
import { invalid, ApiError } from "@t-box/server-foundation/errors";
import { parseId } from "../validation.js";
import type { Principal } from "../ledgers/types.js";
import { FeatureService } from "./base.js";

const tables: Record<LedgerRecordKind, string> = {
  bill: "bills",
  debt: "debt_positions",
  settlement: "debt_settlements",
  refund: "ledger_refunds",
  transfer: "ledger_transfers",
  reimbursement: "ledger_reimbursements",
  "reimbursement-receipt": "ledger_reimbursement_receipts",
  "debt-adjustment": "ledger_debt_adjustments",
  "account-entry": "ledger_account_entries",
};
export function recordKind(value: unknown): LedgerRecordKind {
  if (!ledgerRecordKinds.includes(value as LedgerRecordKind))
    invalid("kind", "记录类型无效");
  return value as LedgerRecordKind;
}
export async function attachmentSubject(
  db: EntityManager,
  book: string,
  kind: LedgerRecordKind,
  id: string,
) {
  const [row] = await db.query(
    `SELECT created_by FROM ${tables[kind]} WHERE ledger_id=? AND id=?${kind === "bill" ? " AND deleted_at IS NULL" : ""}`,
    [book, id],
  );
  if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "记录不存在或不可访问");
  return row;
}
/** Runs inside the record's transaction; never creates resources or opens a second transaction. */
export async function bindAttachments(
  db: EntityManager,
  actor: Principal,
  book: string,
  kind: LedgerRecordKind,
  id: string,
  value: unknown,
) {
  const ids = attachmentIds(value);
  if (!ids?.length) return;
  await attachmentSubject(db, book, kind, id);
  const [count] = await db.query(
    "SELECT COUNT(*) n FROM ledger_attachments WHERE ledger_id=? AND subject_kind=? AND subject_id=?",
    [book, kind, id],
  );
  const [already] = await db.query(
    `SELECT COUNT(*) n FROM ledger_attachments WHERE ledger_id=? AND subject_kind=? AND subject_id=? AND resource_id IN (${ids.map(() => "?").join(",")})`,
    [book, kind, id, ...ids],
  );
  if (
    Number(count.n) + ids.length - Number(already.n) >
    LEDGER_ATTACHMENT_LIMIT
  )
    invalid("attachments", "每笔最多 20 个附件");
  for (const resource of ids) {
    const [r] = await db.query(
      "SELECT id,size FROM resources WHERE id=? AND user_id=? AND deleted_at IS NULL FOR SHARE",
      [resource, actor.user.id],
    );
    if (!r)
      throw new ApiError(
        404,
        "RESOURCE_NOT_FOUND",
        "附件不存在或不属于当前用户",
      );
    if (Number(r.size) > LEDGER_ATTACHMENT_MAX_BYTES)
      invalid("attachments", "每个附件最大 10 MB");
    await db.query(
      "INSERT INTO ledger_attachments(id,ledger_id,subject_kind,subject_id,resource_id,created_by) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE resource_id=VALUES(resource_id)",
      [randomUUID(), book, kind, id, resource, actor.user.id],
    );
  }
}

export class AttachmentService extends FeatureService {
  async list(
    actor: Principal,
    book: string,
    kind: LedgerRecordKind,
    id: string,
  ) {
    await this.read(actor, book);
    await attachmentSubject(this.db, book, kind, id);
    return this.db.query(
      "SELECT a.id,a.resource_id AS resourceId,r.name,r.mime_type AS mimeType,r.size FROM ledger_attachments a JOIN resources r ON r.id=a.resource_id AND r.deleted_at IS NULL WHERE a.ledger_id=? AND a.subject_kind=? AND a.subject_id=? ORDER BY a.created_at,a.id",
      [book, kind, id],
    );
  }
  async add(
    actor: Principal,
    book: string,
    kind: LedgerRecordKind,
    id: string,
    key: string | undefined,
    resourceIds: string[],
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      "attachment.added",
      { kind, subjectId: id, resourceIds },
      async (db, access) => {
        const row = await attachmentSubject(db, book, kind, id);
        this.access.assertAuthor(access.role, row.created_by, actor.user.id);
        await bindAttachments(db, actor, book, kind, id, resourceIds);
        return this.list(actor, book, kind, id);
      },
    );
  }
  async remove(
    actor: Principal,
    book: string,
    kind: LedgerRecordKind,
    id: string,
    attachment: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      "attachment.removed",
      { kind, subjectId: id, attachment },
      async (db, access) => {
        const record = await attachmentSubject(db, book, kind, id);
        this.access.assertAuthor(access.role, record.created_by, actor.user.id);
        await db.query(
          "DELETE FROM ledger_attachments WHERE ledger_id=? AND subject_kind=? AND subject_id=? AND id=?",
          [book, kind, id, attachment],
        );
        return { id: attachment };
      },
    );
  }
}

const creationKinds: Record<string, LedgerRecordKind> = {
  "bill.created": "bill",
  "bill.updated": "bill",
  "debt.created": "debt",
  "settlement.created": "settlement",
  "refund.created": "refund",
  "transfer.created": "transfer",
  "reimbursement.requested": "reimbursement",
  "reimbursement.received": "reimbursement-receipt",
  "debt.adjusted": "debt-adjustment",
};
export async function bindOperationAttachments(
  db: EntityManager,
  actor: Principal,
  book: string,
  action: string,
  payload: unknown,
  result: unknown,
) {
  const value = payload as {
    attachmentResourceIds?: unknown;
    kind?: string;
  } | null;
  if (value?.attachmentResourceIds === undefined) return;
  const kind =
    action === "debt.adjusted" && value.kind === "extension"
      ? "debt"
      : creationKinds[action];
  if (!kind) invalid("attachmentResourceIds", "此操作不支持记录附件");
  await bindAttachments(
    db,
    actor,
    book,
    kind,
    parseId((result as { id?: unknown })?.id),
    value.attachmentResourceIds,
  );
}
