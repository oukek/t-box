import { isoTime } from "../ledgers/time.js";
import { notFound } from "./base.js";
import { randomUUID } from "node:crypto";
import type { LedgerAccount } from "@t-box/ledger-contracts";
import type { Principal } from "../ledgers/types.js";
import { FeatureService, optionalId } from "./base.js";
import { object, text, date, today, note } from "../ledgers/validation.js";
import { parseId } from "../validation.js";
import { amount, cents, money } from "../finance/money.js";
import { invalid } from "@t-box/server-foundation/errors";
import { postAccount, activeAccount } from "./account-posting.js";
import { project } from "../statistics/projection.js";
export class AccountService extends FeatureService {
  async list(actor: Principal, book: string): Promise<LedgerAccount[]> {
    await this.read(actor, book);
    const rows = await this.db.query(
      "SELECT a.id,a.name,a.kind,a.archived,COALESCE(SUM(IF(e.entry_date<=?,e.amount,0)),0) AS balance FROM ledger_accounts a LEFT JOIN ledger_account_entries e ON e.ledger_id=a.ledger_id AND e.account_id=a.id WHERE a.ledger_id=? GROUP BY a.id,a.name,a.kind,a.archived ORDER BY a.archived,a.created_at",
      [today(), book],
    );
    return rows.map((r: any) => ({ ...r, archived: !!Number(r.archived) }));
  }
  async create(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ["name", "kind", "openingBalance", "date"]),
      name = text(v.name, "账户名称", 60),
      d = date(v.date);
    if (!["cash", "bank", "wallet", "other"].includes(v.kind as string))
      invalid("kind", "账户类型无效");
    const signed = String(v.openingBalance);
    if (!/^-?(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(signed))
      invalid("openingBalance", "期初余额格式无效");
    return this.finance.operations.run(
      actor,
      book,
      key,
      "account.created",
      v,
      async (db, a) => {
        this.manage(a);
        const id = randomUUID();
        await db.query(
          "INSERT INTO ledger_accounts(id,ledger_id,name,kind,created_by) VALUES(?,?,?,?,?)",
          [id, book, name, v.kind, actor.user.id],
        );
        await postAccount(
          db,
          book,
          id,
          id,
          d,
          cents(signed),
          "期初余额",
          actor.user.id,
        );
        return {
          id,
          name,
          kind: v.kind,
          balance: money(cents(signed)),
          archived: false,
        };
      },
    );
  }
  async update(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ["name", "archived"]);
    return this.finance.operations.run(
      actor,
      book,
      key,
      "account.updated",
      { id, ...v },
      async (db, a) => {
        this.manage(a);
        const [r] = await db.query(
          "SELECT * FROM ledger_accounts WHERE ledger_id=? AND id=?",
          [book, id],
        );
        if (!r) notFound();
        if (v.archived !== undefined && typeof v.archived !== "boolean")
          invalid("archived", "状态无效");
        await db.query(
          "UPDATE ledger_accounts SET name=?,archived=? WHERE id=?",
          [
            v.name === undefined ? r.name : text(v.name, "名称", 60),
            v.archived ?? r.archived,
            id,
          ],
        );
        return { id };
      },
    );
  }
  async entries(actor: Principal, book: string, id: string) {
    await this.read(actor, book);
    const [r] = await this.db.query(
      "SELECT id FROM ledger_accounts WHERE ledger_id=? AND id=?",
      [book, id],
    );
    if (!r) notFound();
    return (
      await this.db.query(
        "SELECT id,subject_id AS subjectId,entry_date AS date,amount,note,created_at AS createdAt FROM ledger_account_entries WHERE ledger_id=? AND account_id=? ORDER BY entry_date DESC,created_at DESC LIMIT 1000",
        [book, id],
      )
    ).map((r: any) => ({ ...r, createdAt: isoTime(r.createdAt) }));
  }
  async reconcile(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ["balance", "date", "note"]);
    const d = date(v.date),
      n = note(v.note),
      target = String(v.balance);
    if (!/^-?(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(target))
      invalid("balance", "余额格式无效");
    return this.finance.operations.run(
      actor,
      book,
      key,
      "account.reconciled",
      { id, ...v },
      async (db, a) => {
        this.manage(a);
        await activeAccount(db, book, id);
        const [r] = await db.query(
          "SELECT COALESCE(SUM(amount),0) balance FROM ledger_account_entries WHERE ledger_id=? AND account_id=? AND entry_date<=?",
          [book, id, d],
        );
        const delta = cents(target) - cents(r.balance),
          subject = randomUUID();
        await postAccount(
          db,
          book,
          id,
          subject,
          d,
          delta,
          `余额核对：${n}`.slice(0, 200),
          actor.user.id,
        );
        return { id, adjustment: money(delta), balance: money(cents(target)) };
      },
    );
  }
  async transfer(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
        "attachmentResourceIds",
        "fromAccountId",
        "toAccountId",
        "amount",
        "date",
        "note",
      ]),
      from = parseId(v.fromAccountId),
      to = parseId(v.toAccountId),
      sum = amount(v.amount),
      d = date(v.date),
      n = note(v.note);
    if (from === to) invalid("toAccountId", "转出转入账户不能相同");
    return this.finance.operations.run(
      actor,
      book,
      key,
      "transfer.created",
      v,
      async (db) => {
        await activeAccount(db, book, from);
        await activeAccount(db, book, to);
        const id = randomUUID();
        await db.query(
          "INSERT INTO ledger_transfers(id,ledger_id,from_account_id,to_account_id,amount,transfer_date,note,created_by) VALUES(?,?,?,?,?,?,?,?)",
          [id, book, from, to, sum, d, n, actor.user.id],
        );
        await postAccount(db, book, from, id, d, -cents(sum), n, actor.user.id);
        await postAccount(db, book, to, id, d, cents(sum), n, actor.user.id);
        await project(db, book, {
          subjectId: id,
          kind: "transfer",
          date: d,
          note: n,
          createdBy: actor.user.id,
        });
        return {
          id,
          fromAccountId: from,
          toAccountId: to,
          amount: sum,
          date: d,
          note: n,
        };
      },
    );
  }
  async transfers(actor: Principal, book: string) {
    await this.read(actor, book);
    return this.db.query(
      "SELECT id,from_account_id AS fromAccountId,to_account_id AS toAccountId,amount,transfer_date AS date,note,reversed FROM ledger_transfers WHERE ledger_id=? ORDER BY transfer_date DESC,created_at DESC LIMIT 500",
      [book],
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
      "transfer.reversed",
      { id },
      async (db, a) => {
        const [r] = await db.query(
          "SELECT * FROM ledger_transfers WHERE ledger_id=? AND id=?",
          [book, id],
        );
        if (!r) notFound();
        this.access.assertAuthor(a.role, r.created_by, actor.user.id);
        if (Number(r.reversed)) return { id };
        await db.query("UPDATE ledger_transfers SET reversed=TRUE WHERE id=?", [
          id,
        ]);
        await postAccount(
          db,
          book,
          r.from_account_id,
          id,
          r.transfer_date,
          cents(r.amount),
          "撤销转账",
          actor.user.id,
        );
        await postAccount(
          db,
          book,
          r.to_account_id,
          id,
          r.transfer_date,
          -cents(r.amount),
          "撤销转账",
          actor.user.id,
        );
        return { id };
      },
    );
  }
}
