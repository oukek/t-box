import { notFound } from "./base.js";
import { randomUUID } from "node:crypto";
import type { Principal } from "../ledgers/types.js";
import { FeatureService, optionalId } from "./base.js";
import { object, date, note, text } from "../ledgers/validation.js";
import { parseId } from "../validation.js";
import { amount, cents, money } from "../finance/money.js";
import { invalid } from "@t-box/server-foundation/errors";
import { project } from "../statistics/projection.js";
import { postAccount, activeAccount } from "./account-posting.js";
export class RefundService extends FeatureService {
  async create(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
        "billId",
        "amount",
        "date",
        "note",
        "accountId",
        "attachmentResourceIds",
      ]),
      billId = parseId(v.billId),
      sum = amount(v.amount),
      d = date(v.date),
      n = note(v.note),
      account = optionalId(v.accountId);
    return this.finance.operations.run(
      actor,
      book,
      key,
      "refund.created",
      v,
      async (db) => {
        const [r] = await db.query(
          "SELECT * FROM bills WHERE ledger_id=? AND id=? AND deleted_at IS NULL",
          [book, billId],
        );
        if (!r || r.type !== "expense")
          invalid("billId", "请选择此账本的支出账单");
        if (d < r.bill_date) invalid("date", "退款日期不能早于消费日期");
        const [total] = await db.query(
          "SELECT (SELECT COALESCE(SUM(amount),0) FROM ledger_refunds WHERE ledger_id=? AND bill_id=? AND reversed=FALSE)+(SELECT COALESCE(SUM(amount),0) FROM ledger_reimbursements WHERE ledger_id=? AND bill_id=? AND status<>'cancelled') AS amount",
          [book, billId, book, billId],
        );
        if (cents(total.amount) + cents(sum) > cents(r.amount))
          invalid("amount", "退款与申请报销合计不能超过原支出");
        await activeAccount(db, book, account);
        const id = randomUUID();
        await db.query(
          "INSERT INTO ledger_refunds(id,ledger_id,bill_id,amount,refund_date,note,account_id,created_by) VALUES(?,?,?,?,?,?,?,?)",
          [id, book, billId, sum, d, n, account, actor.user.id],
        );
        await project(db, book, {
          subjectId: id,
          kind: "refund",
          date: d,
          note: n,
          createdBy: actor.user.id,
          expense: -cents(sum),
          cashIn: cents(sum),
          categoryId: r.category,
          billType: "expense",
          count: 0,
        });
        await postAccount(
          db,
          book,
          account,
          id,
          d,
          cents(sum),
          n,
          actor.user.id,
        );
        return { id, billId, amount: sum, date: d, note: n };
      },
    );
  }
  async reverse(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      "refund.reversed",
      { id },
      async (db, a) => {
        const [r] = await db.query(
          "SELECT r.*,b.category FROM ledger_refunds r JOIN bills b ON b.id=r.bill_id WHERE r.ledger_id=? AND r.id=?",
          [book, id],
        );
        if (!r) notFound();
        this.access.assertAuthor(a.role, r.created_by, actor.user.id);
        if (Number(r.reversed)) return { id };
        await db.query("UPDATE ledger_refunds SET reversed=TRUE WHERE id=?", [
          id,
        ]);
        await project(db, book, {
          subjectId: id,
          kind: "correction",
          date: r.refund_date,
          note: "撤销退款",
          createdBy: actor.user.id,
          expense: cents(r.amount),
          cashIn: -cents(r.amount),
          categoryId: r.category,
          billType: "expense",
        });
        await postAccount(
          db,
          book,
          r.account_id,
          id,
          r.refund_date,
          -cents(r.amount),
          "撤销退款",
          actor.user.id,
        );
        return { id };
      },
    );
  }
  async reimburse(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
        "billId",
        "counterparty",
        "amount",
        "attachmentResourceIds",
      ]),
      billId = parseId(v.billId),
      sum = amount(v.amount),
      party = text(v.counterparty, "报销方", 80);
    return this.finance.operations.run(
      actor,
      book,
      key,
      "reimbursement.requested",
      v,
      async (db) => {
        const [b] = await db.query(
          "SELECT * FROM bills WHERE ledger_id=? AND id=? AND deleted_at IS NULL AND type='expense'",
          [book, billId],
        );
        if (!b) invalid("billId", "请选择支出账单");
        const [t] = await db.query(
          "SELECT (SELECT COALESCE(SUM(amount),0) FROM ledger_refunds WHERE ledger_id=? AND bill_id=? AND reversed=FALSE)+(SELECT COALESCE(SUM(amount),0) FROM ledger_reimbursements WHERE ledger_id=? AND bill_id=? AND status<>'cancelled') AS amount",
          [book, billId, book, billId],
        );
        if (cents(t.amount) + cents(sum) > cents(b.amount))
          invalid("amount", "报销与退款合计不能超过原支出");
        const id = randomUUID();
        await db.query(
          "INSERT INTO ledger_reimbursements(id,ledger_id,bill_id,counterparty,amount,created_by) VALUES(?,?,?,?,?,?)",
          [id, book, billId, party, sum, actor.user.id],
        );
        await project(db, book, {
          subjectId: id,
          kind: "reimbursement",
          date: b.bill_date,
          note: "申请报销",
          createdBy: actor.user.id,
          receivable: cents(sum),
        });
        return {
          id,
          billId,
          amount: sum,
          received: "0.00",
          status: "requested",
        };
      },
    );
  }
  async receive(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
        "amount",
        "date",
        "accountId",
        "note",
        "attachmentResourceIds",
      ]),
      sum = amount(v.amount),
      d = date(v.date),
      account = optionalId(v.accountId),
      n = note(v.note);
    return this.finance.operations.run(
      actor,
      book,
      key,
      "reimbursement.received",
      { id, ...v },
      async (db) => {
        const [r] = await db.query(
          "SELECT r.*,b.category,b.bill_date FROM ledger_reimbursements r JOIN bills b ON b.id=r.bill_id WHERE r.ledger_id=? AND r.id=?",
          [book, id],
        );
        if (!r) notFound();
        if (r.status === "cancelled")
          invalid("reimbursement", "报销申请已取消");
        if (cents(sum) + cents(r.received) > cents(r.amount))
          invalid("amount", "收款超过未报销金额");
        if (d < r.bill_date) invalid("date", "收款不能早于原支出");
        await activeAccount(db, book, account);
        const receipt = randomUUID();
        await db.query(
          "INSERT INTO ledger_reimbursement_receipts(id,ledger_id,reimbursement_id,amount,receipt_date,account_id,note,created_by) VALUES(?,?,?,?,?,?,?,?)",
          [receipt, book, id, sum, d, account, n, actor.user.id],
        );
        await db.query(
          "UPDATE ledger_reimbursements SET received=received+?,status=IF(received=amount,'received','partial') WHERE id=?",
          [sum, id],
        );
        await project(db, book, {
          subjectId: receipt,
          kind: "reimbursement",
          date: d,
          note: n,
          createdBy: actor.user.id,
          expense: -cents(sum),
          cashIn: cents(sum),
          receivable: -cents(sum),
          categoryId: r.category,
          billType: "expense",
        });
        await postAccount(
          db,
          book,
          account,
          receipt,
          d,
          cents(sum),
          n,
          actor.user.id,
        );
        return { id: receipt, reimbursementId: id, amount: sum };
      },
    );
  }
  async receipts(actor: Principal, book: string, id: string) {
    await this.read(actor, book);
    return this.db.query(
      "SELECT id,amount,receipt_date AS date,account_id AS accountId,note,reversed,created_by AS createdBy FROM ledger_reimbursement_receipts WHERE ledger_id=? AND reimbursement_id=? ORDER BY created_at DESC",
      [book, id],
    );
  }
  async reverseReceipt(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      "reimbursement.receipt_reversed",
      { id },
      async (db, a) => {
        const [r] = await db.query(
          "SELECT t.*,r.bill_id,b.category FROM ledger_reimbursement_receipts t JOIN ledger_reimbursements r ON r.id=t.reimbursement_id JOIN bills b ON b.id=r.bill_id WHERE t.ledger_id=? AND t.id=?",
          [book, id],
        );
        if (!r) notFound();
        this.access.assertAuthor(a.role, r.created_by, actor.user.id);
        if (Number(r.reversed)) return { id };
        await db.query(
          "UPDATE ledger_reimbursement_receipts SET reversed=TRUE WHERE id=?",
          [id],
        );
        await db.query(
          "UPDATE ledger_reimbursements SET received=received-?,status=IF(received=0,'requested','partial') WHERE id=?",
          [r.amount, r.reimbursement_id],
        );
        await project(db, book, {
          subjectId: id,
          kind: "correction",
          date: r.receipt_date,
          note: "撤销报销到账",
          createdBy: actor.user.id,
          expense: cents(r.amount),
          cashIn: -cents(r.amount),
          receivable: cents(r.amount),
          categoryId: r.category,
          billType: "expense",
        });
        await postAccount(
          db,
          book,
          r.account_id,
          id,
          r.receipt_date,
          -cents(r.amount),
          "撤销报销到账",
          actor.user.id,
        );
        return { id };
      },
    );
  }
  async cancel(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      "reimbursement.cancelled",
      { id },
      async (db, a) => {
        const [r] = await db.query(
          "SELECT r.*,b.bill_date FROM ledger_reimbursements r JOIN bills b ON b.id=r.bill_id WHERE r.ledger_id=? AND r.id=?",
          [book, id],
        );
        if (!r) notFound();
        this.access.assertAuthor(a.role, r.created_by, actor.user.id);
        if (r.status === "cancelled") return { id };
        if (cents(r.received) > 0n)
          invalid("reimbursement", "请先撤销所有到账记录，再取消报销申请");
        await db.query(
          "UPDATE ledger_reimbursements SET status='cancelled' WHERE id=?",
          [id],
        );
        await project(db, book, {
          subjectId: id,
          kind: "correction",
          date: r.bill_date,
          note: "取消报销申请",
          createdBy: actor.user.id,
          receivable: -cents(r.amount),
        });
        return { id };
      },
    );
  }
  async listReimbursements(actor: Principal, book: string) {
    await this.read(actor, book);
    return this.db.query(
      "SELECT id,bill_id AS billId,counterparty,amount,received,status,created_by AS createdBy FROM ledger_reimbursements WHERE ledger_id=? ORDER BY created_at DESC LIMIT 1000",
      [book],
    );
  }
}
