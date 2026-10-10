import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";
import type {
  TaskSummary,
  TaskStatus,
  TaskToolRecord,
  ToolResult,
} from "@t-box/shared";
import type { Actor, TaskPort, ToolJournal } from "../agent/contracts.js";
import { ApiError } from "@t-box/server-foundation/errors";
import { isoTime } from "@t-box/server-foundation/time";
const hash = (call: { name: string; arguments: string }) =>
  createHash("sha256").update(`${call.name}:${call.arguments}`).digest("hex");
const executionKey = (key?: string) =>
  key ? createHash("sha256").update(key).digest("hex") : null;
const uncertain = (effect: string) => ["write", "external"].includes(effect);
const decode = (value: string | unknown) =>
  typeof value === "string" ? JSON.parse(value) : value;
/** MySQL owns execution leases/checkpoints; UI waits release leases until an authenticated client returns. */
export class TaskStore implements TaskPort {
  constructor(readonly source: DataSource) {}
  private recovery?: Promise<void>;
  recover(): Promise<void> {
    // Share one sweep per store; other workers still use guarded primary-key updates.
    if (this.recovery) return this.recovery;
    this.recovery = this.recoverExpired().finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }
  private async recoverExpired() {
    // A range UPDATE takes InnoDB next-key locks even when no lease has expired.
    // Read candidates without locks, then fence each update by its current lease.
    // Bound each sweep so recovery cannot monopolize admission on a large backlog.
    const rows: { id: string }[] = await this.source.query(
      `SELECT id FROM agent_tasks WHERE status='running' AND lease_until < UTC_TIMESTAMP(3) ORDER BY lease_until,id LIMIT 256`,
    );
    for (const { id } of rows) {
      // Never replay a possibly committed write or external request after expiry.
      await this.source.query(
        `UPDATE agent_tasks t SET
      status=IF(EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')), 'needs_review', IF(cancel_requested,'cancelled','paused')),
      active_key=IF(cancel_requested AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),NULL,active_key),
      reason='服务执行已中断，已完成的操作保留',lease_owner=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3)
      WHERE id=? AND status='running' AND lease_until < UTC_TIMESTAMP(3)`,
        [id],
      );
    }
  }
  async create(
    actor: Actor,
    id: string,
    conversationId: string,
    requestId: string,
    checkpoint: unknown,
    agentId: string,
    existingConversation = false,
    archiveRevision?: number,
  ) {
    await this.recover();
    try {
      await this.source.transaction(async (db) => {
        if (existingConversation) {
          const rows = await db.query(
            "SELECT id,revision FROM conversations WHERE id=? AND user_id=? FOR UPDATE",
            [conversationId, actor.user.id],
          );
          if (!rows.length)
            throw new ApiError(
              404,
              "CONVERSATION_NOT_FOUND",
              "会话已删除，任务未执行",
            );
          if (
            archiveRevision !== undefined &&
            Number(rows[0].revision) !== archiveRevision
          )
            throw new ApiError(
              409,
              "CONVERSATION_STALE",
              "会话已在其他连接更新，请重新连接后继续",
            );
        }
        await db.query(
          `INSERT INTO agent_tasks(id,user_id,conversation_id,request_id,status,active_key,agent_id,checkpoint_json) VALUES(?,?,?,?,'queued',?,?,?)`,
          [
            id,
            actor.user.id,
            conversationId,
            requestId,
            conversationId,
            agentId,
            JSON.stringify(checkpoint),
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY")
        throw new ApiError(
          409,
          "TASK_IN_PROGRESS",
          "此会话已有待处理任务，请继续或结束该任务",
        );
      throw error;
    }
  }
  async claim(actor: Actor, id: string, owner: string) {
    await this.recover();
    const result = await this.source.query(
      `UPDATE agent_tasks SET status='running',reason=NULL,lease_owner=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=? AND status IN ('queued','paused','waiting_client') AND cancel_requested=FALSE`,
      [owner, id, actor.user.id],
    );
    if (!result.affectedRows)
      throw new ApiError(
        409,
        "TASK_NOT_RESUMABLE",
        "任务正在执行、已结束或需要核对，不能重复运行",
      );
  }
  async guard(id: string, owner: string) {
    const result = await this.source.query(
      `UPDATE agent_tasks SET lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE id=? AND lease_owner=? AND status='running' AND cancel_requested=FALSE AND lease_until>=UTC_TIMESTAMP(3)`,
      [id, owner],
    );
    if (!result.affectedRows) {
      const [task] = await this.source.query(
        "SELECT cancel_requested FROM agent_tasks WHERE id=? AND lease_owner=?",
        [id, owner],
      );
      if (task?.cancel_requested)
        throw new ApiError(409, "TASK_CANCELLED", "任务已结束");
      throw new ApiError(409, "TASK_LEASE_LOST", "任务已停止或执行租约失效");
    }
  }
  async checkpoint(id: string, owner: string, value: unknown, agentId: string) {
    const serialized = JSON.stringify(value);
    if (serialized.length > 2_000_000)
      throw new ApiError(
        413,
        "TASK_STATE_LIMIT",
        "任务上下文过大，请结束任务后新建会话",
      );
    const result = await this.source.query(
      `UPDATE agent_tasks SET checkpoint_json=?,agent_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_owner=? AND status='running' AND lease_until>=UTC_TIMESTAMP(3)`,
      [serialized, agentId, id, owner],
    );
    if (!result.affectedRows)
      throw new ApiError(409, "TASK_LEASE_LOST", "任务执行租约已失效");
  }
  async finish(
    id: string,
    owner: string,
    status: TaskStatus,
    reason?: string,
    execution?: import("@t-box/shared").MessageExecution,
  ) {
    const terminal = ["completed", "cancelled"].includes(status);
    await this.source.query(
      `UPDATE agent_tasks t SET
      status=IF(EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),'needs_review',IF(cancel_requested,'cancelled',?)),
      active_key=IF((? OR cancel_requested) AND NOT EXISTS(SELECT 1 FROM agent_task_tools x WHERE x.task_id=t.id AND x.effect IN ('write','external') AND x.status IN ('dispatched','uncertain')),NULL,active_key),
      checkpoint_json=IF(? IS NULL,checkpoint_json,JSON_SET(checkpoint_json,'$.execution',JSON_EXTRACT(?,'$'))),
      reason=?,lease_owner=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND lease_owner=? AND status='running'`,
      [
        status,
        terminal,
        execution ? JSON.stringify(execution) : null,
        execution ? JSON.stringify(execution) : null,
        reason?.slice(0, 200) || null,
        id,
        owner,
      ],
    );
  }
  private summary(row: any): TaskSummary {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      status: row.status,
      agentId: row.agent_id,
      updatedAt: isoTime(row.updated_at),
      ...(row.reason ? { reason: row.reason } : {}),
    };
  }
  async get(
    actor: Actor,
    id: string,
  ): Promise<{
    summary: TaskSummary;
    checkpoint: unknown;
    tools: TaskToolRecord[];
  }> {
    await this.recover();
    const [row] = await this.source.query(
      "SELECT * FROM agent_tasks WHERE id=? AND user_id=?",
      [id, actor.user.id],
    );
    if (!row) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    const tools = await this.source.query(
      "SELECT call_id,name,agent_id,effect,status,result_json FROM agent_task_tools WHERE task_id=? ORDER BY updated_at,call_id",
      [id],
    );
    return {
      summary: this.summary(row),
      checkpoint: decode(row.checkpoint_json),
      tools: tools.map((x: any): TaskToolRecord => ({
        callId: x.call_id,
        name: x.name,
        agentId: x.agent_id,
        effect: x.effect,
        status: x.status,
        ...(x.result_json ? { result: decode(x.result_json) } : {}),
      })),
    };
  }
  async current(actor: Actor, conversationId: string) {
    await this.recover();
    const [row] = await this.source.query(
      "SELECT id,conversation_id,status,agent_id,updated_at,reason FROM agent_tasks WHERE active_key=? AND user_id=?",
      [conversationId, actor.user.id],
    );
    return row ? this.summary(row) : null;
  }
  async list(actor: Actor): Promise<TaskSummary[]> {
    await this.recover();
    const rows = await this.source.query(
      "SELECT id,conversation_id,status,agent_id,updated_at,reason FROM agent_tasks WHERE user_id=? ORDER BY updated_at DESC,id LIMIT 100",
      [actor.user.id],
    );
    return rows.map((row: any) => this.summary(row));
  }
  async cancel(actor: Actor, id: string) {
    await this.recover();
    const result = await this.source.query(
      `UPDATE agent_tasks SET cancel_requested=TRUE,
      status=IF(status='running',status,'cancelled'), active_key=IF(status='running',active_key,NULL),updated_at=UTC_TIMESTAMP(3)
      WHERE id=? AND user_id=? AND status IN ('queued','running','paused','waiting_client','needs_review')`,
      [id, actor.user.id],
    );
    if (!result.affectedRows)
      throw new ApiError(409, "TASK_NOT_CANCELLABLE", "任务已结束或不存在");
  }
  async cancelSuspended(actor: Actor, id: string) {
    await this.recover();
    const result = await this.source.query(
      `UPDATE agent_tasks SET cancel_requested=TRUE,status='cancelled',active_key=NULL,
       reason='用户发送新消息或调整会话，旧任务已结束；实际工具结果仍保留',updated_at=UTC_TIMESTAMP(3)
       WHERE id=? AND user_id=? AND status IN ('paused','waiting_client','needs_review') AND lease_owner IS NULL`,
      [id, actor.user.id],
    );
    if (!result.affectedRows)
      throw new ApiError(409, "TASK_CHANGED", "旧任务状态已改变，请刷新后重试");
  }
  journal(id: string, owner: string): ToolJournal {
    return {
      guard: () => this.guard(id, owner),
      lookup: async (call) => {
        await this.guard(id, owner);
        const [row] = await this.source.query(
          "SELECT call_id,fingerprint,effect,status,result_json FROM agent_task_tools WHERE task_id=? AND (call_id=? OR execution_key=?) ORDER BY (call_id=?) DESC LIMIT 1",
          [id, call.id, executionKey(call.writeKey), call.id],
        );
        if (!row) return undefined;
        if (row.call_id === call.id && row.fingerprint !== hash(call))
          throw new ApiError(409, "CALL_ID_CONFLICT", "持久工具调用标识冲突");
        if (row.status === "completed")
          return decode(row.result_json) as ToolResult;
        if (uncertain(row.effect))
          throw new ApiError(
            409,
            "TOOL_OUTCOME_UNCERTAIN",
            "工具结果需要核对，禁止自动重复写入",
          );
        return undefined;
      },
      dispatch: async (call, effect, agentId) => {
        // Lock the task and persist intent in one transaction before dispatching a side effect.
        // The parent row serializes this task's calls; do not gap-lock absent tool
        // receipts across unrelated tasks before their first INSERT.
        await this.source.transaction("READ COMMITTED", async (db) => {
          const [task] = await db.query(
            "SELECT lease_owner,cancel_requested,status,lease_until>=UTC_TIMESTAMP(3) AS valid FROM agent_tasks WHERE id=? FOR UPDATE",
            [id],
          );
          if (
            !task ||
            task.lease_owner !== owner ||
            task.status !== "running" ||
            task.cancel_requested ||
            !task.valid
          )
            throw new ApiError(409, "TASK_LEASE_LOST", "任务已停止或租约失效");
          const [previous] = await db.query(
            "SELECT fingerprint,effect,status FROM agent_task_tools WHERE task_id=? AND (call_id=? OR execution_key=?) FOR UPDATE",
            [id, call.id, executionKey(call.writeKey)],
          );
          if (
            previous &&
            (previous.fingerprint !== hash(call) ||
              previous.status === "completed" ||
              uncertain(previous.effect))
          )
            throw new ApiError(
              409,
              "TOOL_ALREADY_DISPATCHED",
              "同一工具操作已提交，不能重复执行",
            );
          await db.query(
            `INSERT INTO agent_task_tools(task_id,call_id,name,agent_id,fingerprint,execution_key,effect,status) VALUES(?,?,?,?,?,?,?,'dispatched') ON DUPLICATE KEY UPDATE status='dispatched',updated_at=UTC_TIMESTAMP(3)`,
            [
              id,
              call.id,
              call.name,
              agentId,
              hash(call),
              executionKey(call.writeKey),
              effect,
            ],
          );
        });
      },
      complete: async (callId, result) => {
        // Cancellation does not prevent an already dispatched operation from recording its outcome.
        const outcome = !result.ok ? "uncertain" : "completed";
        const effect = await this.source.transaction(async (db) => {
          // Every journal mutation locks the parent before its tools, matching dispatch/recovery.
          // A multi-table UPDATE can choose the opposite order and deadlock concurrent recovery.
          const [task] = await db.query(
            "SELECT lease_owner,status,lease_until>=UTC_TIMESTAMP(3) AS valid FROM agent_tasks WHERE id=? FOR UPDATE",
            [id],
          );
          if (
            !task ||
            task.lease_owner !== owner ||
            task.status !== "running" ||
            !task.valid
          )
            throw new ApiError(
              409,
              "TASK_LEASE_LOST",
              "工具执行结果未能持久保存，请核对操作",
            );
          const resultDB = await db.query(
            "UPDATE agent_task_tools SET result_json=?,status=IF(effect IN ('write','external'),?,'completed'),updated_at=UTC_TIMESTAMP(3) WHERE task_id=? AND call_id=?",
            [JSON.stringify(result), outcome, id, callId],
          );
          if (!resultDB.affectedRows)
            throw new ApiError(
              409,
              "TASK_LEASE_LOST",
              "工具执行结果未能持久保存，请核对操作",
            );
          const [row] = await db.query(
            "SELECT effect FROM agent_task_tools WHERE task_id=? AND call_id=?",
            [id, callId],
          );
          return row?.effect as string | undefined;
        });
        if (!result.ok) {
          if (effect && uncertain(effect))
            throw new ApiError(
              409,
              "TOOL_OUTCOME_UNCERTAIN",
              `操作结果未能确认：${result.error.message.slice(0, 140)}；请核对后结束该任务`,
            );
        }
      },
    };
  }
}
