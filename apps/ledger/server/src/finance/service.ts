import { validateCategoryIcon } from "../categories/icons.js";
import { LedgerFeatures } from "../features/service.js";
import { postAccount, activeAccount } from "../features/account-posting.js";
import { isoTime } from "../ledgers/time.js";
import { aggregateSummary, type SummaryRow } from "../repository.js";
import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import type {
  Bill,
  BillInput,
  BillCategory,
  Debt,
  Settlement,
  BillSummary,
} from "@t-box/ledger-contracts";
import { ApiError, invalid, notFound } from "../errors.js";
import {
  parseId,
  parseBillInput,
  parseListFilters,
  monthBounds,
} from "../validation.js";
import { parseCategoryInput } from "../categories/validation.js";
import {
  debtInput,
  settlementInput,
  object,
  date,
} from "../ledgers/validation.js";
import type { LedgerAccess } from "../ledgers/access.js";
import type { Principal, Access } from "../ledgers/types.js";
import { FinancialOperations } from "./operations.js";
import { amount, cents, money } from "./money.js";
import { project } from "../statistics/projection.js";
import type { StatisticsService } from "../statistics/service.js";
const billDTO = (row: any): Bill => ({
  id: row.id,
  createdBy: row.created_by,
  type: row.type,
  amount: row.amount,
  category: row.category,
  date: row.bill_date,
  note: row.note,
  createdAt: isoTime(row.created_at),
  updatedAt: isoTime(row.updated_at),
  accountId: row.account_id ?? null,
});
const debtDTO = (row: any): Debt => ({
  id: row.id,
  ledgerId: row.ledger_id,
  direction: row.direction,
  counterparty: row.counterparty,
  amount: row.amount,
  settled: row.settled,
  adjusted: row.adjusted ?? "0.00",
  remaining: row.remaining,
  status: cents(row.remaining) > 0n ? "open" : "settled",
  date: row.occurred_date,
  dueDate: row.due_date,
  note: row.note,
  cashMovement: Boolean(Number(row.cash_movement)),
  accountId: row.account_id ?? null,
  contactId: row.contact_id ?? null,
  createdBy: row.created_by,
  createdAt: isoTime(row.created_at),
});
function ordinary(access: Access) {
  if (access.book.template === "debt")
    invalid("template", "往来账本仅记录应收、应付；收支请使用综合或日常账本");
}
function debtEnabled(access: Access) {
  if (access.book.template === "daily")
    invalid("template", "此账本仅记录日常收支，请使用往来或综合账本");
}
async function category(
  db: EntityManager,
  book: string,
  input: Pick<BillInput, "category" | "type">,
  allowInactive = false,
) {
  const [row] = await db.query(
    "SELECT 1 FROM bill_categories WHERE id=? AND type=? AND ledger_id=? AND (active=TRUE OR ?=TRUE)",
    [input.category, input.type, book, allowInactive],
  );
  if (!row) invalid("category", "分类不存在、类型不匹配或不属于当前账本");
}
export async function billDelta(
  db: EntityManager,
  id: string,
  row: Bill,
  actor: string,
  sign = 1n,
) {
  const value = cents(row.amount) * sign;
  await postAccount(
    db,
    id,
    row.accountId,
    row.id,
    row.date,
    row.type === "income" ? value : -value,
    row.note,
    actor,
  );
  await project(db, id, {
    subjectId: row.id,
    kind: sign < 0n ? "correction" : row.type,
    date: row.date,
    note: row.note,
    createdBy: actor,
    categoryId: row.category,
    billType: row.type,
    count: Number(sign),
    ...(row.type === "income"
      ? { income: value, cashIn: value }
      : { expense: value, cashOut: value }),
  });
}
export class FinanceService {
  readonly operations: FinancialOperations;
  readonly features: LedgerFeatures;
  constructor(
    readonly access: LedgerAccess,
    readonly statistics: StatisticsService,
  ) {
    this.operations = new FinancialOperations(access);
    this.features = new LedgerFeatures(this);
  }
  async categories(principal: Principal, id: string): Promise<BillCategory[]> {
    await this.access.check(principal, id);
    return this.access.source
      .query(
        "SELECT id,label,type,icon,icon_id AS iconId,is_default AS isDefault,active,pinned,sort_order AS sortOrder FROM bill_categories WHERE ledger_id=? ORDER BY pinned DESC,type,sort_order,label,id",
        [id],
      )
      .then((rows) =>
        rows.map((row: BillCategory) => ({
          ...row,
          isDefault: Boolean(Number(row.isDefault)),
          active: Boolean(Number(row.active)),
          pinned: Boolean(Number(row.pinned)),
        })),
      );
  }
  async createCategory(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const input = parseCategoryInput(value);
    return this.operations.run(
      principal,
      id,
      key,
      "category.created",
      input,
      async (db) => {
        const result = {
          id: randomUUID(),
          ...input,
          icon: input.icon ?? "other",
          isDefault: false,
          iconId: await validateCategoryIcon(
            db,
            id,
            principal.user.id,
            input.iconId,
          ),
        };
        await db.query(
          "INSERT INTO bill_categories(id,ledger_id,label,type,icon,icon_id,is_default,sort_order) VALUES(?,?,?,?,?,?,FALSE,100)",
          [
            result.id,
            id,
            result.label,
            result.type,
            result.icon,
            result.iconId,
          ],
        );
        return result;
      },
    );
  }
  async bills(principal: Principal, id: string, query: unknown) {
    await this.access.check(principal, id);
    const input = object(query, [
      "month",
      "type",
      "q",
      "page",
      "pageSize",
      "start",
      "end",
      "categoryId",
      "memberId",
      "minAmount",
      "maxAmount",
    ]);
    const { start, end, categoryId, memberId, minAmount, maxAmount, ...rest } =
      input;
    const filters = parseListFilters(rest);
    const conditions = ["ledger_id=?", "deleted_at IS NULL"];
    const parameters: any[] = [id];
    if (start !== undefined || end !== undefined) {
      if (filters.month) invalid("month", "不能与日期范围同时使用");
      const from = date(start),
        to = date(end);
      if (from > to) invalid("end", "结束日期须在开始日期之后");
      conditions.push("bill_date BETWEEN ? AND ?");
      parameters.push(from, to);
    }
    if (filters.month) {
      conditions.push("bill_date BETWEEN ? AND ?");
      parameters.push(...monthBounds(filters.month));
    }
    if (filters.type) {
      conditions.push("type=?");
      parameters.push(filters.type);
    }
    if (filters.q) {
      conditions.push("LOCATE(?,note)>0");
      parameters.push(filters.q);
    }
    if (categoryId !== undefined) {
      conditions.push("category=?");
      parameters.push(parseId(categoryId));
    }
    if (memberId !== undefined) {
      conditions.push("created_by=?");
      parameters.push(parseId(memberId));
    }
    for (const [value, operator] of [
      [minAmount, ">="],
      [maxAmount, "<="],
    ] as const)
      if (value !== undefined) {
        conditions.push(`amount${operator}?`);
        if (
          typeof value !== "string" ||
          !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)
        )
          invalid("amount", "筛选金额须为非负金额，最多两位小数");
        parameters.push(money(cents(value)));
      }
    if (
      minAmount !== undefined &&
      maxAmount !== undefined &&
      cents(String(minAmount)) > cents(String(maxAmount))
    )
      invalid("maxAmount", "最高金额不能低于最低金额");
    const where = conditions.join(" AND ");
    const rows = await this.access.source.query(
      `SELECT * FROM bills WHERE ${where} ORDER BY bill_date DESC,created_at DESC,id DESC LIMIT ? OFFSET ?`,
      [...parameters, filters.pageSize, (filters.page - 1) * filters.pageSize],
    );
    const [{ total }] = await this.access.source.query(
      `SELECT COUNT(*) AS total FROM bills WHERE ${where}`,
      parameters,
    );
    return {
      data: rows.map(billDTO),
      meta: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: Number(total),
      },
    };
  }
  async getBill(principal: Principal, id: string, billId: string) {
    await this.access.check(principal, id);
    const [row] = await this.access.source.query(
      "SELECT * FROM bills WHERE ledger_id=? AND id=? AND deleted_at IS NULL",
      [id, billId],
    );
    if (!row) notFound();
    return billDTO(row);
  }
  async summary(
    principal: Principal,
    id: string,
    month?: string,
  ): Promise<BillSummary> {
    if (!month)
      return this.access.source.transaction("REPEATABLE READ", async (db) => {
        await this.access.check(principal, id, "read", false, db);
        const rows = (await db.query(
          "SELECT type,category_id AS category,SUM(amount) AS amount,SUM(record_count) AS count FROM ledger_daily_categories WHERE ledger_id=? GROUP BY type,category_id",
          [id],
        )) as SummaryRow[];
        return aggregateSummary(rows);
      });
    const data = await this.statistics.get(principal, id, {
      period: "month",
      ...(month ? { value: month } : {}),
    });
    return {
      income: data.income,
      expense: data.expense,
      balance: data.balance,
      count: data.count,
      categories: data.categories
        .filter((row) => row.type === "expense")
        .map(({ category, amount }) => ({ category, amount })),
    };
  }
  async createBill(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const input = parseBillInput(value) as BillInput;
    return this.operations.run(
      principal,
      id,
      key,
      "bill.created",
      input,
      async (db, access) => {
        ordinary(access);
        await category(db, id, input);
        await activeAccount(db, id, input.accountId);
        const billId = randomUUID();
        await db.query(
          "INSERT INTO bills(id,ledger_id,type,amount,category,bill_date,note,created_by,account_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
          [
            billId,
            id,
            input.type,
            input.amount,
            input.category,
            input.date,
            input.note,
            principal.user.id,
            input.accountId ?? null,
          ],
        );
        const [row] = await db.query("SELECT * FROM bills WHERE id=?", [
          billId,
        ]);
        const result = billDTO(row);
        await billDelta(db, id, result, principal.user.id);
        await db.query(
          "INSERT INTO ledger_category_recents(id,ledger_id,user_id,category_id,last_used_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE last_used_at=UTC_TIMESTAMP(3)",
          [randomUUID(), id, principal.user.id, result.category],
        );
        return result;
      },
    );
  }
  async updateBill(
    principal: Principal,
    id: string,
    billId: string,
    key: string | undefined,
    value: unknown,
  ) {
    const patch = parseBillInput(value, true);
    return this.operations.run(
      principal,
      id,
      key,
      "bill.updated",
      { billId, ...patch },
      async (db, access) => {
        ordinary(access);
        const [row] = await db.query(
          "SELECT * FROM bills WHERE ledger_id=? AND id=? AND deleted_at IS NULL",
          [id, billId],
        );
        if (!row) notFound();
        this.access.assertAuthor(
          access.role,
          row.created_by,
          principal.user.id,
        );
        const old = billDTO(row),
          next = { ...old, ...patch };
        await category(
          db,
          id,
          next,
          next.category === old.category && next.type === old.type,
        );
        if (next.accountId !== old.accountId)
          await activeAccount(db, id, next.accountId);
        const [linked] = await db.query(
          "SELECT (SELECT COUNT(*) FROM ledger_refunds WHERE bill_id=? AND reversed=FALSE)+(SELECT COUNT(*) FROM ledger_reimbursements WHERE bill_id=? AND status<>'cancelled') AS count",
          [billId, billId],
        );
        if (
          Number(linked.count) &&
          ["type", "amount", "category", "date", "accountId"].some(
            (k) => (next as any)[k] !== (old as any)[k],
          )
        )
          throw new ApiError(
            409,
            "BILL_LINKED",
            "账单存在退款或报销，不能直接修改财务内容",
          );
        await db.query(
          "UPDATE bills SET type=?,amount=?,category=?,bill_date=?,note=?,account_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
          [
            next.type,
            next.amount,
            next.category,
            next.date,
            next.note,
            next.accountId ?? null,
            billId,
          ],
        );
        if (
          ["type", "amount", "category", "date", "accountId"].some(
            (k) => (next as any)[k] !== (old as any)[k],
          )
        ) {
          await billDelta(db, id, old, principal.user.id, -1n);
          await billDelta(db, id, next, principal.user.id);
        }
        const [updated] = await db.query("SELECT * FROM bills WHERE id=?", [
          billId,
        ]);
        return billDTO(updated);
      },
    );
  }
  async deleteBill(
    principal: Principal,
    id: string,
    billId: string,
    key: string | undefined,
  ) {
    return this.operations.run(
      principal,
      id,
      key,
      "bill.deleted",
      { billId },
      async (db, access) => {
        const [row] = await db.query(
          "SELECT * FROM bills WHERE ledger_id=? AND id=? AND deleted_at IS NULL",
          [id, billId],
        );
        if (!row) notFound();
        this.access.assertAuthor(
          access.role,
          row.created_by,
          principal.user.id,
        );
        const [linked] = await db.query(
          "SELECT (SELECT COUNT(*) FROM ledger_refunds WHERE bill_id=? AND reversed=FALSE)+(SELECT COUNT(*) FROM ledger_reimbursements WHERE bill_id=? AND status<>'cancelled') AS count",
          [billId, billId],
        );
        if (Number(linked.count))
          throw new ApiError(
            409,
            "BILL_LINKED",
            "账单存在退款或报销，不能直接删除",
          );
        await db.query(
          "UPDATE bills SET deleted_at=UTC_TIMESTAMP(3) WHERE id=?",
          [billId],
        );
        await billDelta(db, id, billDTO(row), principal.user.id, -1n);
        return { id: billId, removed: true };
      },
    );
  }
  async debts(principal: Principal, id: string, query: unknown) {
    await this.access.check(principal, id);
    const input = object(query, [
      "direction",
      "status",
      "q",
      "counterparty",
      "page",
      "pageSize",
    ]);
    const pagination = parseListFilters({
      ...(input.page ? { page: input.page } : {}),
      ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    });
    let where = "ledger_id=?";
    const params: any[] = [id];
    if (input.direction !== undefined) {
      if (!["receivable", "payable"].includes(input.direction as string))
        invalid("direction", "方向无效");
      where += " AND direction=?";
      params.push(input.direction);
    }
    if (input.status !== undefined) {
      if (!["open", "settled"].includes(input.status as string))
        invalid("status", "状态无效");
      where +=
        input.status === "open" ? " AND remaining>0" : " AND remaining=0";
    }
    if (input.q !== undefined) {
      if (typeof input.q !== "string" || input.q.length > 80)
        invalid("q", "搜索内容过长");
      where += " AND (LOCATE(?,counterparty)>0 OR LOCATE(?,note)>0)";
      params.push(input.q, input.q);
    }
    if (input.counterparty !== undefined) {
      if (
        typeof input.counterparty !== "string" ||
        !input.counterparty ||
        input.counterparty.length > 80
      )
        invalid("counterparty", "对象无效");
      where += " AND counterparty=?";
      params.push(input.counterparty);
    }
    const [{ total }] = await this.access.source.query(
      `SELECT COUNT(*) AS total FROM debt_positions WHERE ${where}`,
      params,
    );
    const rows = await this.access.source.query(
      `SELECT * FROM debt_positions WHERE ${where} ORDER BY (remaining>0) DESC,occurred_date DESC,created_at DESC,id DESC LIMIT ? OFFSET ?`,
      [
        ...params,
        pagination.pageSize,
        (pagination.page - 1) * pagination.pageSize,
      ],
    );
    return {
      data: rows.map(debtDTO),
      meta: { ...pagination, total: Number(total) },
    };
  }
  async createDebt(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const input = debtInput(value);
    return this.operations.run(
      principal,
      id,
      key,
      "debt.created",
      input,
      async (db, access) => {
        debtEnabled(access);
        await activeAccount(db, id, input.accountId);
        if (!input.cashMovement && input.accountId)
          invalid("accountId", "补录往来不能指定资金账户");
        if (input.contactId) {
          const [contact] = await db.query(
            "SELECT name FROM ledger_contacts WHERE ledger_id=? AND id=? AND archived=FALSE",
            [id, input.contactId],
          );
          if (!contact) invalid("contactId", "往来对象不存在");
          input.counterparty = contact.name;
        }
        const debtId = randomUUID(),
          value = cents(input.amount);
        await db.query(
          "INSERT INTO debt_positions(id,ledger_id,direction,counterparty,amount,settled,remaining,occurred_date,due_date,note,cash_movement,created_by,account_id,contact_id) VALUES(?,?,?,?,?,0,?,?,?,?,?,?,?,?)",
          [
            debtId,
            id,
            input.direction,
            input.counterparty,
            input.amount,
            input.amount,
            input.date,
            input.dueDate,
            input.note,
            input.cashMovement,
            principal.user.id,
            input.accountId ?? null,
            input.contactId ?? null,
          ],
        );
        if (input.cashMovement)
          await postAccount(
            db,
            id,
            input.accountId,
            debtId,
            input.date,
            input.direction === "receivable" ? -value : value,
            input.note,
            principal.user.id,
          );
        await project(db, id, {
          subjectId: debtId,
          kind: input.direction === "receivable" ? "lend" : "borrow",
          date: input.date,
          note: input.note,
          createdBy: principal.user.id,
          ...(input.direction === "receivable"
            ? {
                receivable: value,
                ...(input.cashMovement ? { cashOut: value } : {}),
              }
            : {
                payable: value,
                ...(input.cashMovement ? { cashIn: value } : {}),
              }),
        });
        const [row] = await db.query(
          "SELECT * FROM debt_positions WHERE id=?",
          [debtId],
        );
        return debtDTO(row);
      },
    );
  }
  async settlements(principal: Principal, id: string): Promise<Settlement[]> {
    await this.access.check(principal, id);
    const rows = await this.access.source.query(
      "SELECT * FROM debt_settlements WHERE ledger_id=? ORDER BY settled_date DESC,created_at DESC,id DESC LIMIT 500",
      [id],
    );
    const ids = rows.map((row: { id: string }) => row.id);
    const allocations = ids.length
      ? await this.access.source.query(
          `SELECT settlement_id,debt_id AS debtId,amount FROM settlement_allocations WHERE ledger_id=? AND settlement_id IN (${ids.map(() => "?").join(",")})`,
          [id, ...ids],
        )
      : [];
    return rows.map((row: any) => ({
      id: row.id,
      direction: row.direction,
      counterparty: row.counterparty,
      amount: row.amount,
      date: row.settled_date,
      note: row.note,
      createdBy: row.created_by,
      reversed: Boolean(Number(row.reversed)),
      allocations: allocations
        .filter((entry: any) => entry.settlement_id === row.id)
        .map(({ debtId, amount }: any) => ({ debtId, amount })),
    }));
  }
  async settle(
    principal: Principal,
    id: string,
    key: string | undefined,
    value: unknown,
  ): Promise<Settlement> {
    const input = settlementInput(value);
    return this.operations.run(
      principal,
      id,
      key,
      "settlement.created",
      input,
      async (db, access) => {
        debtEnabled(access);
        await activeAccount(db, id, input.accountId);
        const ids = input.allocations.map((row) => row.debtId).sort();
        const debts = await db.query(
          `SELECT * FROM debt_positions WHERE ledger_id=? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
          [id, ...ids],
        );
        if (debts.length !== ids.length)
          invalid("allocations", "部分往来不存在或不属于此账本");
        const first = debts[0];
        let total = 0n;
        for (const allocation of input.allocations) {
          const debt = debts.find((row: any) => row.id === allocation.debtId);
          if (
            debt.direction !== first.direction ||
            debt.counterparty !== first.counterparty
          )
            invalid(
              "allocations",
              "一次收还款只能关联同一对象、同一方向的往来",
            );
          if (input.date < debt.occurred_date)
            invalid("date", "收还款日期不能早于关联往来的发生日期");
          const value = cents(allocation.amount);
          if (value > cents(debt.remaining))
            throw new ApiError(
              409,
              "OVER_SETTLEMENT",
              "收还款超过剩余金额，请刷新往来余额",
            );
          total += value;
        }
        const result: Settlement = {
          id: randomUUID(),
          direction: first.direction,
          counterparty: first.counterparty,
          amount: money(total),
          date: input.date,
          note: input.note,
          createdBy: principal.user.id,
          reversed: false,
          allocations: input.allocations,
        };
        await db.query(
          "INSERT INTO debt_settlements(id,ledger_id,direction,counterparty,amount,settled_date,note,created_by,account_id) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            result.id,
            id,
            result.direction,
            result.counterparty,
            result.amount,
            result.date,
            result.note,
            principal.user.id,
            input.accountId ?? null,
          ],
        );
        for (const allocation of input.allocations) {
          await db.query(
            "INSERT INTO settlement_allocations(ledger_id,settlement_id,debt_id,amount) VALUES(?,?,?,?)",
            [id, result.id, allocation.debtId, allocation.amount],
          );
          await db.query(
            "UPDATE debt_positions SET settled=settled+?,remaining=remaining-? WHERE id=?",
            [allocation.amount, allocation.amount, allocation.debtId],
          );
        }
        await postAccount(
          db,
          id,
          input.accountId,
          result.id,
          result.date,
          result.direction === "receivable" ? total : -total,
          result.note,
          principal.user.id,
        );
        await project(db, id, {
          subjectId: result.id,
          kind: result.direction === "receivable" ? "collect" : "repay",
          date: result.date,
          note: result.note,
          createdBy: principal.user.id,
          ...(result.direction === "receivable"
            ? { receivable: -total, cashIn: total }
            : { payable: -total, cashOut: total }),
        });
        return result;
      },
    );
  }
  async reverseSettlement(
    principal: Principal,
    id: string,
    settlementId: string,
    key: string | undefined,
  ) {
    return this.operations.run(
      principal,
      id,
      key,
      "settlement.reversed",
      { settlementId },
      async (db, access) => {
        const [row] = await db.query(
          "SELECT * FROM debt_settlements WHERE id=? AND ledger_id=?",
          [settlementId, id],
        );
        if (!row) notFound();
        this.access.assertAuthor(
          access.role,
          row.created_by,
          principal.user.id,
        );
        if (Number(row.reversed)) return { id: settlementId, reversed: true };
        const allocations = await db.query(
          "SELECT * FROM settlement_allocations WHERE settlement_id=?",
          [settlementId],
        );
        for (const allocation of allocations)
          await db.query(
            "UPDATE debt_positions SET settled=settled-?,remaining=remaining+? WHERE id=?",
            [allocation.amount, allocation.amount, allocation.debt_id],
          );
        await db.query("UPDATE debt_settlements SET reversed=TRUE WHERE id=?", [
          settlementId,
        ]);
        const amount = cents(row.amount);
        await postAccount(
          db,
          id,
          row.account_id,
          settlementId,
          row.settled_date,
          row.direction === "receivable" ? -amount : amount,
          "撤销收还款",
          principal.user.id,
        );
        await project(db, id, {
          subjectId: settlementId,
          kind: "correction",
          date: row.settled_date,
          note: `撤销收还款：${row.note}`.slice(0, 200),
          createdBy: principal.user.id,
          ...(row.direction === "receivable"
            ? { receivable: amount, cashIn: -amount }
            : { payable: amount, cashOut: -amount }),
        });
        return { id: settlementId, reversed: true };
      },
    );
  }
  async events(principal: Principal, id: string, query: unknown) {
    await this.access.check(principal, id);
    const input = object(query, ["start", "end", "page", "pageSize"]);
    const filters = parseListFilters({
      ...(input.page ? { page: input.page } : {}),
      ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    });
    const start = date(input.start),
      end = date(input.end);
    if (start > end) invalid("end", "日期范围无效");
    const params = [id, start, end];
    const [{ total }] = await this.access.source.query(
      "SELECT COUNT(*) AS total FROM ledger_events WHERE ledger_id=? AND event_date BETWEEN ? AND ?",
      params,
    );
    const data = await this.access.source.query(
      "SELECT id,subject_id AS subjectId,kind,event_date AS date,income,expense,cash_in AS inflow,cash_out AS outflow,receivable_delta AS receivableChange,payable_delta AS payableChange,note,created_by AS createdBy FROM ledger_events WHERE ledger_id=? AND event_date BETWEEN ? AND ? ORDER BY event_date DESC,created_at DESC,id DESC LIMIT ? OFFSET ?",
      [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
    );
    return { data, meta: { ...filters, total: Number(total) } };
  }
}
