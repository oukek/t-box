import { randomUUID } from "node:crypto";
import type { LedgerBatchResult } from "@t-box/ledger-contracts";
import type { Principal } from "../ledgers/types.js";
import type { LedgerFeatures } from "./service.js";
import { FeatureService } from "./base.js";
import { object } from "../ledgers/validation.js";
import { invalid } from "@t-box/server-foundation/errors";
export function batchInput(value: unknown) {
  const v = object(value, ["items"]);
  if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > 100)
    invalid("items", "每次可批量提交 1–100 笔记录");
  const refs = new Set<string>();
  return v.items.map((item, index) => {
    const r = object(item, ["kind", "input", "ref"]);
    if (
      !["bill", "debt", "settlement", "refund", "transfer"].includes(
        r.kind as string,
      )
    )
      invalid("kind", `第 ${index + 1} 笔类型无效`);
    if (r.ref !== undefined && r.ref !== null) {
      if (
        typeof r.ref !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(r.ref) ||
        refs.has(r.ref)
      )
        invalid("ref", "批内标识须唯一且为 1–32 个英文、数字或下划线");
      refs.add(r.ref);
    }
    if (
      r.input === null ||
      typeof r.input !== "object" ||
      Array.isArray(r.input)
    )
      invalid("input", `第 ${index + 1} 笔内容无效`);
    return {
      kind: r.kind as "bill" | "debt" | "settlement" | "refund" | "transfer",
      input: r.input as Record<string, unknown>,
      ...(typeof r.ref === "string" ? { ref: r.ref } : {}),
    };
  });
}
export class BatchService extends FeatureService {
  constructor(
    finance: FeatureService["finance"],
    readonly features: LedgerFeatures,
  ) {
    super(finance);
  }
  async create(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ): Promise<LedgerBatchResult> {
    const items = batchInput(value);
    return this.finance.operations.run(
      actor,
      book,
      key,
      "batch.created",
      { items },
      async () => {
        const refs = new Map<string, { id: string; kind: string }>();
        const result: LedgerBatchResult = { id: randomUUID(), items: [] };
        for (let i = 0; i < items.length; i++) {
          const row = items[i]!,
            input = structuredClone(row.input);
          const resolve = (id: unknown, kind: string) => {
            if (typeof id !== "string" || !id.startsWith("ref:")) return id;
            const prev = refs.get(id.slice(4));
            if (!prev || prev.kind !== kind)
              invalid(
                "ref",
                `第 ${i + 1} 笔必须引用前面已创建的${kind === "bill" ? "账单" : "往来"}`,
              );
            return prev.id;
          };
          if (row.kind === "refund")
            input.billId = resolve(input.billId, "bill");
          if (row.kind === "settlement" && Array.isArray(input.allocations))
            input.allocations = input.allocations.map((entry) => {
              const r = object(entry, ["debtId", "amount"]);
              return { ...r, debtId: resolve(r.debtId, "debt") };
            });
          let saved: Record<string, unknown>;
          try {
            const childKey = `batch:${result.id}:${i}`;
            saved = (await (row.kind === "bill"
              ? this.finance.createBill(actor, book, childKey, input)
              : row.kind === "debt"
                ? this.finance.createDebt(actor, book, childKey, input)
                : row.kind === "settlement"
                  ? this.finance.settle(actor, book, childKey, input)
                  : row.kind === "refund"
                    ? this.features.refunds.create(actor, book, childKey, input)
                    : this.features.accounts.transfer(
                        actor,
                        book,
                        childKey,
                        input,
                      ))) as unknown as Record<string, unknown>;
          } catch (error) {
            if (error instanceof Error)
              error.message = `第 ${i + 1} 笔：${error.message}`;
            throw error;
          }
          if (row.ref)
            refs.set(row.ref, { id: String(saved.id), kind: row.kind });
          result.items.push({
            kind: row.kind,
            ...(row.ref ? { ref: row.ref } : {}),
            result: saved,
          });
        }
        return result;
      },
    );
  }
}
