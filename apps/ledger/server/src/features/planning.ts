import { isoTime } from "../ledgers/time.js";
import { notFound } from "./base.js";
import { randomUUID } from "node:crypto";
import { dayjs } from "@t-box/dayjs";
import type { Principal } from "../ledgers/types.js";
import type { BillInput, LedgerRule } from "@t-box/ledger-contracts";
import { FeatureService, integer, json, optionalId } from "./base.js";
import { object, text, date, today } from "../ledgers/validation.js";
import { parseBillInput, validateMonth, monthBounds } from "../validation.js";
import { activeAccount } from "./account-posting.js";
import { amount, cents, money } from "../finance/money.js";
import { invalid } from "@t-box/server-foundation/errors";
/** Advance from the original anchor so Jan 31 -> Feb 28 -> Mar 31, including leap-day anniversaries. */
export function nextOccurrence(
  start: string,
  frequency: string,
  interval: number,
  after: string,
) {
  const anchor = dayjs.utc(start);
  const unit =
    frequency === "week" ? "week" : frequency === "year" ? "year" : "month";
  let n = Math.max(
    1,
    Math.floor(dayjs.utc(after).diff(anchor, unit, true) / interval),
  );
  while (n < 100000) {
    const candidate = anchor.add(n * interval, unit).format("YYYY-MM-DD");
    if (candidate > after) return candidate;
    n++;
  }
  invalid("frequency", "周期日期超出范围");
}
export class PlanningService extends FeatureService {
  async budgets(actor: Principal, book: string, month: string) {
    await this.read(actor, book);
    validateMonth(month);
    const [start, end] = monthBounds(month);
    const rows = await this.db.query(
      "SELECT b.id,b.budget_month AS month,b.category_id AS categoryId,b.amount,COALESCE((SELECT SUM(s.amount) FROM ledger_daily_categories s WHERE s.ledger_id=b.ledger_id AND s.type='expense' AND s.stat_date BETWEEN ? AND ? AND (b.category_id='' OR s.category_id=b.category_id)),0) AS spent FROM ledger_budgets b WHERE b.ledger_id=? AND b.budget_month=? ORDER BY b.category_id",
      [start, end, book, month],
    );
    return rows.map((r: any) => ({
      ...r,
      categoryId: r.categoryId || null,
      remaining: money(cents(r.amount) - cents(r.spent)),
      ratio: Math.max(0, Number(cents(r.spent)) / Number(cents(r.amount))),
    }));
  }
  async budget(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ["month", "categoryId", "amount"]),
      month = validateMonth(v.month);
    if (!month) invalid("month", "请选择月份");
    const cat = optionalId(v.categoryId),
      sum = amount(v.amount);
    return this.finance.operations.run(
      actor,
      book,
      key,
      "budget.saved",
      v,
      async (db, a) => {
        this.manage(a);
        if (cat) {
          const [r] = await db.query(
            "SELECT id FROM bill_categories WHERE ledger_id=? AND id=? AND type='expense' AND active=TRUE",
            [book, cat],
          );
          if (!r) invalid("categoryId", "请选择支出分类");
        }
        const id = randomUUID();
        await db.query(
          "INSERT INTO ledger_budgets(id,ledger_id,budget_month,category_id,amount,created_by) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)",
          [id, book, month, cat ?? "", sum, actor.user.id],
        );
        const [r] = await db.query(
          "SELECT id FROM ledger_budgets WHERE ledger_id=? AND budget_month=? AND category_id=?",
          [book, month, cat ?? ""],
        );
        return { id: r.id };
      },
    );
  }
  async removeBudget(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      "budget.deleted",
      { id },
      async (db, a) => {
        this.manage(a);
        await db.query(
          "DELETE FROM ledger_budgets WHERE ledger_id=? AND id=?",
          [book, id],
        );
        return { id };
      },
    );
  }
  async rules(actor: Principal, book: string): Promise<LedgerRule[]> {
    await this.read(actor, book);
    return (
      await this.db.query(
        "SELECT id,name,bill_json AS bill,frequency,interval_count AS `interval`,start_date AS startDate,next_date AS nextDate,end_date AS endDate,mode,enabled,last_error AS lastError FROM ledger_rules WHERE ledger_id=? ORDER BY next_date",
        [book],
      )
    ).map((r: any) => ({
      ...r,
      bill: json(r.bill),
      enabled: !!Number(r.enabled),
    }));
  }
  async createRule(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
        "name",
        "bill",
        "frequency",
        "interval",
        "startDate",
        "endDate",
        "mode",
      ]),
      name = text(v.name, "规则名称", 60),
      bill = parseBillInput(v.bill) as BillInput,
      start = date(v.startDate),
      end = v.endDate === null ? null : date(v.endDate),
      interval = integer(v.interval, "间隔", 1, 99);
    if (
      !["week", "month", "year"].includes(v.frequency as string) ||
      !["remind", "automatic"].includes(v.mode as string)
    )
      invalid("mode", "周期或执行方式无效");
    if (end && end < start) invalid("endDate", "结束日期不能早于开始日期");
    return this.finance.operations.run(
      actor,
      book,
      key,
      "rule.created",
      v,
      async (db, a) => {
        if (a.book.template === "debt")
          invalid("template", "往来账本不支持周期收支");
        const [c] = await db.query(
          "SELECT id FROM bill_categories WHERE ledger_id=? AND id=? AND type=? AND active=TRUE",
          [book, bill.category, bill.type],
        );
        if (!c) invalid("category", "分类不可用");
        await activeAccount(db, book, bill.accountId);
        const id = randomUUID();
        await db.query(
          "INSERT INTO ledger_rules(id,ledger_id,name,bill_json,frequency,interval_count,start_date,next_date,end_date,mode,created_by,grant_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            book,
            name,
            JSON.stringify(bill),
            v.frequency,
            interval,
            start,
            start,
            end,
            v.mode,
            actor.user.id,
            a.book.password_version,
          ],
        );
        return { id, name, mode: v.mode };
      },
    );
  }
  async toggleRule(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ["enabled"]);
    if (typeof v.enabled !== "boolean") invalid("enabled", "请选择状态");
    return this.finance.operations.run(
      actor,
      book,
      key,
      "rule.updated",
      { id, ...v },
      async (db, a) => {
        const [r] = await db.query(
          "SELECT created_by FROM ledger_rules WHERE ledger_id=? AND id=?",
          [book, id],
        );
        if (!r) notFound();
        this.access.assertAuthor(a.role, r.created_by, actor.user.id);
        await db.query(
          "UPDATE ledger_rules SET enabled=?,last_error=NULL,grant_version=? WHERE id=?",
          [v.enabled, a.book.password_version, id],
        );
        return { id };
      },
    );
  }
  async notices(actor: Principal, book: string) {
    await this.read(actor, book);
    return (
      await this.db.query(
        "SELECT id,title,body,is_read AS `read`,created_at AS createdAt FROM ledger_notices WHERE ledger_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100",
        [book, actor.user.id],
      )
    ).map((r: any) => ({
      ...r,
      read: Boolean(Number(r.read)),
      createdAt: isoTime(r.createdAt),
    }));
  }
  async readNotice(actor: Principal, book: string, id: string) {
    await this.read(actor, book);
    await this.db.query(
      "UPDATE ledger_notices SET is_read=TRUE WHERE ledger_id=? AND user_id=? AND id=?",
      [book, actor.user.id, id],
    );
    return { id };
  }
}
