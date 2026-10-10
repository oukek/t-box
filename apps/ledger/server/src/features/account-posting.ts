import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { invalid } from "@t-box/server-foundation/errors";
import { money } from "../finance/money.js";
/** Same book lock and transaction as the originating financial event. */
export async function postAccount(
  db: EntityManager,
  book: string,
  account: string | null | undefined,
  subject: string,
  date: string,
  value: bigint,
  note: string,
  actor: string | null,
) {
  if (!account || value === 0n) return;
  const [row] = await db.query(
    "SELECT id,archived FROM ledger_accounts WHERE ledger_id=? AND id=?",
    [book, account],
  );
  if (!row) invalid("accountId", "资金账户不存在或不属于此账本");
  // Reversals can post to archived accounts; callers validate active accounts for new operations.
  await db.query(
    "INSERT INTO ledger_account_entries(id,ledger_id,account_id,subject_id,entry_date,amount,note,created_by) VALUES(?,?,?,?,?,?,?,?)",
    [randomUUID(), book, account, subject, date, money(value), note, actor],
  );
}
export async function activeAccount(
  db: EntityManager,
  book: string,
  id: string | null | undefined,
) {
  if (!id) return;
  const [row] = await db.query(
    "SELECT id FROM ledger_accounts WHERE ledger_id=? AND id=? AND archived=FALSE",
    [book, id],
  );
  if (!row) invalid("accountId", "请选择此账本可用的资金账户");
}
