import { ApplicationError } from "@t-box/app-server-sdk";
import type { ChatMessage, ToolCallView, ToolResult } from "@t-box/shared";
import { randomUUID } from "node:crypto";
import { ApiError } from "@t-box/server-foundation/errors";
import type { SessionRun } from "../chat/session.js";
import type { ModelCall } from "../chat/provider.js";
import type { ToolContext } from "./contracts.js";
import { requestClient, requireClient } from "./interaction.js";
import { MessageTimeline } from "./timeline.js";
export function toolError(error: unknown): ToolResult {
  return {
    ok: false,
    error:
      error instanceof ApiError || error instanceof ApplicationError
        ? {
            code: error.code,
            message:
              error instanceof ApiError && error.details
                ? Object.values(error.details).join("；")
                : error.message,
          }
        : {
            code: "TOOL_FAILED",
            message: "工具执行未能确认结果，请检查服务状态；不要自动重复写入。",
          },
  };
}
/** Generic dispatch. Domain validation, permission requirements and UI proposals belong to modules. */
export async function executeTool(
  ctx: ToolContext,
  run: SessionRun,
  message: ChatMessage,
  call: ModelCall,
  writes: Map<string, ToolResult>,
  host: { save(): Promise<void>; clientTimeoutMs?: number },
): Promise<ToolResult> {
  const { session, registry } = ctx;
  const agent = registry.agentScope(ctx.agentId || "assistant")?.agent;
  const timeline = new MessageTimeline(session, run.view.id, message, {
    id: ctx.agentId || "assistant",
    title: agent?.title || "日常助手",
  });
  const fingerprint = `${call.name}:${call.arguments}`;
  const prior = session.calls.get(call.id);
  const tool = registry.tools[call.name];
  const allowed =
    (!ctx.toolAllowlist || ctx.toolAllowlist.has(call.name)) &&
    registry.allowedTools(ctx.skills).some((t) => t.name === call.name);
  if (allowed) {
    try {
      await registry.requireTool(call.name, JSON.parse(call.arguments), ctx);
    } catch (error) {
      const result = toolError(error);
      const denied: ToolCallView = {
        id: call.id,
        name: call.name,
        title: tool?.title || call.name,
        execution: tool?.execution || "server",
        status: "failed",
        summary: result.ok ? undefined : result.error.message,
      };
      const index = message.toolCalls.findIndex((v) => v.id === call.id);
      if (index >= 0) message.toolCalls[index] = denied;
      else message.toolCalls.push(denied);
      timeline.tool(denied);
      session.send?.({
        type: "tool.update",
        runId: run.view.id,
        messageId: message.id,
        tool: denied,
      });
      await host.save();
      return result;
    }
  }
  if (prior && allowed) {
    if (prior.fingerprint === fingerprint)
      tool?.restoreState?.(prior.result, ctx);
    return prior.fingerprint === fingerprint
      ? prior.result
      : {
          ok: false,
          error: {
            code: "CALL_ID_CONFLICT",
            message: "工具调用标识冲突，未重复执行",
          },
        };
  }
  let durableCall = { ...call, writeKey: undefined as string | undefined };
  if (allowed && tool?.writeFingerprint && call.arguments.length <= 8000) {
    try {
      durableCall.writeKey = `${call.name}:${tool.writeFingerprint(JSON.parse(call.arguments))}`;
    } catch {
      /* The ordinary argument validation below reports the error. */
    }
  }
  const durable = allowed ? await ctx.journal?.lookup(durableCall) : undefined;
  if (durable) {
    tool?.restoreState?.(durable, ctx);
    session.calls.set(call.id, { fingerprint, result: durable });
    let cachedView = message.toolCalls.find((v) => v.id === call.id);
    if (!cachedView) {
      cachedView = {
        id: call.id,
        name: call.name,
        title: tool!.title,
        execution: tool!.execution,
        status: "completed",
      };
      message.toolCalls.push(cachedView);
    }
    cachedView.status = durable.ok ? "completed" : "failed";
    cachedView.summary = durable.ok
      ? tool!.successSummary
      : durable.error.message;
    if (durable.ok && tool!.attachments)
      message.attachments = [
        ...new Map(
          [
            ...(message.attachments || []),
            ...tool!.attachments(durable.data),
          ].map((r) => [r.id, r]),
        ).values(),
      ];
    timeline.tool(cachedView);
    session.send?.({
      type: "tool.update",
      runId: run.view.id,
      messageId: message.id,
      tool: { ...cachedView },
      attachments: message.attachments,
    });
    return durable;
  }
  const view: ToolCallView = message.toolCalls.find(
    (v) => v.id === call.id,
  ) || {
    id: call.id,
    name: call.name,
    title: tool?.title ?? "未知工具",
    execution: tool?.execution ?? "server",
    status: "running",
  };
  if (!message.toolCalls.includes(view)) message.toolCalls.push(view);
  view.status = "running";
  delete view.summary;
  delete view.preview;
  const update = () => {
    timeline.tool(view);
    session.send?.({
      type: "tool.update",
      runId: run.view.id,
      messageId: message.id,
      tool: { ...view },
      attachments: message.attachments,
    });
  };
  update();
  const interact: ToolContext["interact"] = (request) =>
    requestClient(
      session,
      run,
      randomUUID(),
      request,
      host.clientTimeoutMs,
      () => {
        view.status = "waiting_client";
        update();
      },
    );
  const context = { ...ctx, callId: call.id, interact };
  let result: ToolResult;
  let writeKey: string | undefined;
  let dispatched = false;
  try {
    if (
      !tool ||
      (ctx.toolAllowlist && !ctx.toolAllowlist.has(call.name)) ||
      !registry
        .allowedTools(ctx.skills)
        .some((entry) => entry.name === call.name)
    )
      throw new ApiError(400, "TOOL_NOT_ALLOWED", "工具未注册或尚未启用");
    if (call.arguments.length > 8000)
      throw new ApiError(400, "INVALID_ARGUMENTS", "工具参数过长");
    const args: unknown = JSON.parse(call.arguments);
    run.abort.signal.throwIfAborted();
    const requirements = (await tool.resources?.(args, context)) ?? [];
    if (requirements.length && !ctx.actor)
      throw new ApiError(401, "AUTH_REQUIRED", "请先登录");
    for (const requirement of requirements)
      await registry.access.ensure(
        ctx.actor!,
        requirement.resource,
        requirement.action,
        interact,
        tool.title,
      );
    registry.access.mark(
      session.messages,
      requirements.map((r) => r.resource),
    );
    if (requirements.length) await host.save();
    run.abort.signal.throwIfAborted();
    if (ctx.answerRetry && ["write", "external"].includes(tool.effect)) {
      writeKey = `${call.name}:${tool.writeFingerprint ? tool.writeFingerprint(args) : JSON.stringify(args)}`;
      result = writes.get(writeKey) ?? {
        ok: false,
        error: {
          code: "RETRY_SIDE_EFFECT_BLOCKED",
          message:
            "重试回答不会重新执行写入或生成，请核对旧操作；需要执行新操作时请发送新消息。",
        },
      };
      if (result.ok) tool.restoreState?.(result, context);
    } else if (tool.execution === "client") {
      const normalized = await tool.normalizeClientArguments!(args, context);
      await registry.requireTool(call.name, args, context);
      requireClient(session, run);
      await ctx.journal?.dispatch(
        durableCall,
        tool.effect,
        ctx.agentId || "assistant",
      );
      dispatched = true;
      if (tool.preview) {
        view.preview = { ...tool.preview };
        update();
      }
      result = await interact({
        name: tool.clientAction || call.name,
        arguments: normalized,
      });
      result = tool.sanitizeClientResult?.(result) ?? result;
    } else {
      writeKey = tool.writeFingerprint
        ? `${call.name}:${tool.writeFingerprint(args)}`
        : undefined;
      if (writeKey && writes.has(writeKey)) result = writes.get(writeKey)!;
      else {
        if (writeKey)
          writes.set(writeKey, {
            ok: false,
            error: {
              code: "WRITE_PENDING",
              message: "同一操作已提交，不能重复执行",
            },
          });
        if (tool.confirm) {
          const consent = await interact(await tool.confirm(args, context));
          if (
            !consent.ok ||
            (consent.data as { approved?: boolean })?.approved !== true
          )
            throw new ApiError(400, "USER_DECLINED", "用户未确认，操作未执行");
          run.abort.signal.throwIfAborted();
          await registry.requireTool(call.name, args, ctx);
          // Permission may expire or be revoked while the user is reviewing the proposal.
          for (const requirement of requirements)
            await registry.access.ensure(
              ctx.actor!,
              requirement.resource,
              requirement.action,
              undefined,
              tool.title,
            );
        }
        if (!tool.handler)
          throw new ApiError(400, "TOOL_NOT_ALLOWED", "工具没有服务端处理器");
        run.abort.signal.throwIfAborted();
        await tool.validate?.(args, context);
        run.abort.signal.throwIfAborted();
        await ctx.journal?.guard();
        await ctx.journal?.dispatch(
          durableCall,
          tool.effect,
          ctx.agentId || "assistant",
        );
        dispatched = true;
        if (tool.preview) {
          view.preview = { ...tool.preview };
          update();
        }
        result = { ok: true, data: await tool.handler(args, context) };
      }
    }
    if (result.ok && tool.attachments) {
      const resources = tool.attachments(result.data);
      message.attachments = [
        ...new Map(
          [...(message.attachments || []), ...resources].map((r) => [r.id, r]),
        ).values(),
      ];
    }
  } catch (error) {
    // Leave the call on the checkpoint cursor. A missing client is not a tool result.
    if (
      run.abort.signal.reason === "CLIENT_REQUIRED" &&
      (!dispatched || tool?.execution === "client")
    ) {
      if (writeKey) writes.delete(writeKey);
      view.status = "waiting_client";
      view.summary = "等待打开应用后处理";
      update();
      throw error;
    }
    result =
      error instanceof SyntaxError
        ? {
            ok: false,
            error: {
              code: "INVALID_ARGUMENTS",
              message: "工具参数不是有效 JSON",
            },
          }
        : toolError(error);
  }
  if (run.abort.signal.aborted && !dispatched) {
    if (writeKey) writes.delete(writeKey);
    throw run.abort.signal.reason;
  }
  if (dispatched) {
    try {
      await ctx.journal?.complete(call.id, result);
    } catch (error) {
      // The durable journal may require review; still show the actual tool error before the run stops.
      view.status = "failed";
      view.summary = result.ok
        ? "执行结果未能保存，请核对操作"
        : result.error.message;
      update();
      throw error;
    }
  }
  // Remember uncertain outcomes too: a new call ID must never silently retry a dispatched write.
  if (writeKey) writes.set(writeKey, result);
  session.calls.set(call.id, { fingerprint, result });
  view.status = result.ok ? "completed" : "failed";
  view.summary = result.ok
    ? (tool?.successSummary ?? "执行完成")
    : result.error.message;
  update();
  return result;
}
