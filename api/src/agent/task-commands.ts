import { authorizedSnapshot } from "./snapshot.js";
import { ApiError } from "@t-box/server-foundation/errors";
import { type ChatSession } from "../chat/session.js";
import type { Actor, AgentRuntimeOptions } from "./contracts.js";
import type { AgentRunInput } from "./runner.js";
import { object, parseIdentifier } from "./schema.js";
import {
  closeInterruptedHistory,
  restoreCheckpoint,
  type RunCheckpoint,
} from "./checkpoint.js";
const fail = (code: string, message: string): never => {
  throw new ApiError(400, code, message);
};
/** Transport-independent commands for durable task ownership, compatibility and resume. */
export async function handleTaskCommand(
  options: AgentRuntimeOptions,
  current: ChatSession,
  principal: Actor | undefined,
  event: Record<string, unknown>,
  isConnected: () => boolean,
  launch: (input: AgentRunInput) => void,
): Promise<void> {
  if (event.type === "task.cancel") {
    object(event, ["type", "taskId"]);
    const taskId = parseIdentifier(event.taskId);
    if (!principal || !options.host?.tasks)
      fail("TASKS_UNAVAILABLE", "持久任务服务不可用");
    await options.host!.identity.authenticateHash(principal!.sessionHash);
    await options.host!.tasks!.cancel(principal!, taskId);
    if (current.active?.view.id === taskId)
      current.active.abort.abort("CANCELLED");
    else if (
      current.task?.id === taskId &&
      !current.active &&
      current.task.status !== "running"
    ) {
      closeInterruptedHistory(current);
      current.history.push({
        role: "assistant",
        content: "任务已结束。已完成操作保留，不自动重复执行。",
      });
      await options.host!.conversations?.save(current);
    }
    current.task = current.conversationId
      ? await options.host!.tasks!.current(principal!, current.conversationId)
      : null;
    current.send?.({
      type: "session.snapshot",
      snapshot: await authorizedSnapshot(
        options,
        current,
        options.provider.mode,
        principal,
      ),
    });
    return;
  }
  if (event.type === "task.resume") {
    object(event, ["type", "taskId"]);
    if (!principal || !options.host?.tasks)
      fail("TASKS_UNAVAILABLE", "持久任务服务不可用");
    if (current.active || current.finishing)
      fail("RUN_IN_PROGRESS", "请等待当前任务结束");
    await options.host!.identity.authenticateHash(principal!.sessionHash);
    const task = await options.host!.tasks!.get(
      principal!,
      parseIdentifier(event.taskId),
    );
    if (task.summary.conversationId !== current.conversationId)
      fail("TASK_CONVERSATION_MISMATCH", "请打开此任务所属会话后继续");
    if (!["queued", "paused", "waiting_client"].includes(task.summary.status))
      fail("TASK_NOT_RESUMABLE", "此任务不能继续，结果不确定的操作请先核对");
    const checkpoint = task.checkpoint as RunCheckpoint;
    if (checkpoint.version !== 1 || checkpoint.runId !== task.summary.id)
      fail("TASK_VERSION_MISMATCH", "任务格式不兼容，请核对后结束任务");
    if (
      checkpoint.modulePins
        ? Object.entries(checkpoint.modulePins).some(
            ([id, pin]) => options.registry.moduleRevision(id) !== pin.revision,
          )
        : checkpoint.registryRevision !== options.registry.revision
    )
      fail(
        "TASK_CAPABILITIES_CHANGED",
        "任务的应用或技能版本已改变，请核对后结束旧任务",
      );
    await options.registry.access.history(
      principal!,
      checkpoint.session.messages,
    );
    if (
      options.host!.conversations &&
      !(await options.host!.conversations.exists(
        principal!,
        task.summary.conversationId,
      ))
    ) {
      if (current.archived)
        fail("CONVERSATION_NOT_FOUND", "会话已删除，不能继续任务");
      current.finishing = true;
      try {
        restoreCheckpoint(current, checkpoint);
        await options.host!.conversations.save(current);
      } finally {
        current.finishing = false;
      }
    }
    for (const ref of options.registry.access.parse(checkpoint.bindings))
      await options.registry.access.inspect(
        principal!,
        ref,
        "read",
        "继续任务",
      );
    const provider = options.provider.forRun
      ? await options.provider.forRun()
      : options.provider;
    if (provider.mode === "unconfigured")
      fail("AI_NOT_CONFIGURED", "尚未接入 AI，请在后台配置普通会话模型");
    if (checkpoint.session.configurationKey !== provider.configurationKey)
      fail(
        "TASK_MODEL_CHANGED",
        "任务使用的模型配置已改变，请恢复原配置或核对后结束任务",
      );
    if (!isConnected()) return;
    if (current.active || current.finishing)
      fail("RUN_IN_PROGRESS", "当前任务尚未结束");
    launch({
      session: current,
      requestId: checkpoint.requestId,
      text: "",
      localDate: checkpoint.localDate,
      principal,
      bindings: checkpoint.bindings,
      attachments: [],
      provider,
      applicationIds: checkpoint.applicationIds,
      resume: checkpoint,
    });
    return;
  }
}
