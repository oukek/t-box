import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
export async function audit(
  db: EntityManager,
  ledgerId: string,
  userId: string | null,
  action: string,
  subjectId: string | null,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO ledger_audit(id,ledger_id,user_id,action,subject_id,details) VALUES(?,?,?,?,?,?)",
    [
      randomUUID(),
      ledgerId,
      userId,
      action,
      subjectId,
      JSON.stringify(details),
    ],
  );
}
