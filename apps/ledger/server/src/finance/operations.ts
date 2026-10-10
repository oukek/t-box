import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { digest } from "@t-box/server-foundation/crypto";
import { ApiError, invalid } from "@t-box/server-foundation/errors";
import { audit } from "../ledgers/audit.js";
import type { LedgerAccess } from "../ledgers/access.js";
import type { Principal, Access } from "../ledgers/types.js";
import { bindOperationAttachments } from "../features/attachments.js";
/** One committed result per actor + book + request key, surviving reconnection/restarts. */
export class FinancialOperations {
  private readonly context = new AsyncLocalStorage<{
    db: EntityManager;
    access: Access;
    ledgerId: string;
    sessionHash: string;
  }>();
  constructor(readonly access: LedgerAccess) {}
  get manager() {
    return this.context.getStore()?.db ?? this.access.source.manager;
  }
  async run<T>(
    principal: Principal,
    ledgerId: string,
    key: string | undefined,
    action: string,
    payload: unknown,
    work: (db: EntityManager, access: Access) => Promise<T>,
  ): Promise<T> {
    if (!key || !/^[A-Za-z0-9_:.\-]{1,128}$/.test(key))
      invalid("Idempotency-Key", "请提供有效的操作标识");
    const hash = digest(JSON.stringify({ action, payload }));
    const execute = async (db: EntityManager, access: Access) => {
      const [previous] = await db.query(
        "SELECT payload_hash,result_json FROM ledger_operations WHERE ledger_id=? AND user_id=? AND request_key=?",
        [ledgerId, principal.user.id, key],
      );
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new ApiError(
            409,
            "REQUEST_CONFLICT",
            "同一操作标识不能用于不同内容",
          );
        return typeof previous.result_json === "string"
          ? JSON.parse(previous.result_json)
          : previous.result_json;
      }
      const result = await this.context.run(
        { db, access, ledgerId, sessionHash: principal.sessionHash },
        () => work(db, access),
      );
      await bindOperationAttachments(
        db,
        principal,
        ledgerId,
        action,
        payload,
        result,
      );
      await db.query(
        "INSERT INTO ledger_operations(id,ledger_id,user_id,request_key,payload_hash,action,result_json) VALUES(?,?,?,?,?,?,?)",
        [
          randomUUID(),
          ledgerId,
          principal.user.id,
          key,
          hash,
          action,
          JSON.stringify(result),
        ],
      );
      await db.query("UPDATE ledgers SET revision=revision+1 WHERE id=?", [
        ledgerId,
      ]);
      await audit(
        db,
        ledgerId,
        principal.user.id,
        action,
        action.startsWith("attachment.")
          ? ((payload as { subjectId?: string; bill?: string } | null)
              ?.subjectId ??
              (payload as { bill?: string } | null)?.bill ??
              null)
          : ((result as { id?: string } | null)?.id ?? null),
        payload,
      );
      return result;
    };
    const current = this.context.getStore();
    if (current) {
      if (
        current.ledgerId !== ledgerId ||
        current.sessionHash !== principal.sessionHash
      )
        throw new ApiError(403, "BATCH_SCOPE", "批量操作不能跨账本或用户");
      return execute(current.db, current.access);
    }
    return this.access.transaction(principal, ledgerId, "write", execute);
  }
}
