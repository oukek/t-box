import { settingNumber } from "../configuration/defaults.js";
import {
  phaseInstructions,
  phaseLabels,
  phaseTools,
  readPlan,
  readReview,
  missingRequiredTools,
} from "./workflow.js";
import { receiptEvidence } from "./evidence.js";
import { receiptCompletion } from "./completion.js";
import { prepareContext } from "./context.js";
import { modelRequest } from "./model-retry.js";
import type { ChatMessage, ToolResult } from "@t-box/shared";
import type {
  ChatProvider,
  ModelCall,
  ProviderInput,
  ProviderUsage,
} from "../chat/provider.js";
import type { SessionRun } from "../chat/session.js";
import type { AgentRuntimeOptions, ToolContext } from "./contracts.js";
import type { AgentFrame, RunCheckpoint } from "./checkpoint.js";
import { object } from "./schema.js";
import { executeTool, toolError } from "./executor.js";
import { ApiError } from "@t-box/server-foundation/errors";
import { randomUUID } from "node:crypto";
import { MessageTimeline } from "./timeline.js";
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
const output = (frame: AgentFrame, call: ModelCall, result: ToolResult) => {
  frame.history.push({
    type: "function_call_output",
    call_id: call.id,
    output: JSON.stringify(result),
  });
  frame.calls.shift();
};
/** A persisted stack: delegates have isolated model histories, tools and skill boundaries. */
export async function orchestrate(
  options: AgentRuntimeOptions,
  ctx: ToolContext,
  run: SessionRun,
  message: ChatMessage,
  provider: ChatProvider,
  state: RunCheckpoint,
  save: () => Promise<void>,
) {
  const writes = new Map(state.writes);
  while (state.frames.length) {
    run.abort.signal.throwIfAborted();
    await ctx.journal?.guard();
    if (ctx.actor && options.host) {
      await options.host.identity.authenticateHash(ctx.actor.sessionHash);
      await options.registry.access.history(
        ctx.actor,
        ctx.session.messages,
        ctx.interact,
      );
    }
    const frame = state.frames.at(-1)!;
    const scope = options.registry.agentScope(frame.agentId);
    const current: ToolContext = {
      modulePins: state.modulePins,
      ...ctx,
      agentId: frame.agentId,
      skills: new Set(frame.skills),
      toolAllowlist: scope?.tools,
      skillAllowlist: scope?.skills,
      applicationAllowlist: scope?.applications,
    };
    if (scope)
      await options.registry.requireModule(scope.agent.moduleId, current);
    for (const id of Object.keys(state.modulePins || {}))
      await options.registry.requireModule(id, current);
    const title = scope?.agent.title || "日常助手";
    const timeline = new MessageTimeline(ctx.session, run.view.id, message, {
      id: frame.agentId,
      title,
    });
    if (run.view.agentId !== frame.agentId) {
      run.view.agentId = frame.agentId;
      run.view.agentTitle = title;
      ctx.session.send?.({
        type: "agent.changed",
        runId: run.view.id,
        agentId: frame.agentId,
        title,
      });
    }
    if (frame.done) {
      if (state.frames.length === 1) return;
      state.frames.pop();
      const parent = state.frames.at(-1)!;
      const call = parent.calls[0]!;
      if (call.id !== frame.parentCallId)
        throw new Error("Invalid delegation checkpoint");
      const result: ToolResult = {
        ok: true,
        data: {
          agentId: frame.agentId,
          summary: frame.content || "专业 Agent 已完成处理，请以工具记录为准",
        },
      };
      output(parent, call, result);
      ctx.session.calls.set(call.id, {
        fingerprint: `${call.name}:${call.arguments}`,
        result,
      });
      const view = message.toolCalls.find((v) => v.id === call.id);
      if (view) {
        view.status = "completed";
        view.summary = "专业 Agent 已返回结果";
        timeline.tool(view);
        ctx.session.send?.({
          type: "tool.update",
          runId: run.view.id,
          messageId: message.id,
          tool: { ...view },
        });
      }
      await save();
      continue;
    }
    if (frame.calls.length) {
      const call = frame.calls[0]!;
      if (
        call.name === "agent_delegate" &&
        frame.agentId === "assistant" &&
        options.registry.tools.agent_delegate
      ) {
        try {
          const args = object(JSON.parse(call.arguments), ["agentId", "task"]);
          await options.registry.requireTool(call.name, args, current);
          if (
            typeof args.agentId !== "string" ||
            typeof args.task !== "string" ||
            !args.task.trim() ||
            args.task.length > 2000
          )
            throw new ApiError(
              400,
              "INVALID_ARGUMENTS",
              "请提供明确的专业 Agent 子任务",
            );
          const child = options.registry.agentScope(args.agentId);
          if (
            !child ||
            state.delegations >=
              settingNumber(state.configuration, "ai.run.delegations", 4)
          )
            throw new ApiError(
              400,
              "DELEGATION_LIMIT",
              "专业 Agent 委派次数已达上限",
            );
          if (ctx.session.calls.has(call.id)) {
            const prior = ctx.session.calls.get(call.id)!;
            if (prior.fingerprint !== `${call.name}:${call.arguments}`)
              throw new ApiError(409, "CALL_ID_CONFLICT", "工具调用标识冲突");
            output(frame, call, prior.result);
            await save();
            continue;
          }
          state.delegations++;
          if (!message.toolCalls.some((v) => v.id === call.id))
            message.toolCalls.push({
              id: call.id,
              name: call.name,
              title: child.agent.title,
              execution: "server",
              status: "running",
            });
          const delegationView = message.toolCalls.find(
            (v) => v.id === call.id,
          )!;
          timeline.tool(delegationView);
          ctx.session.send?.({
            type: "tool.update",
            runId: run.view.id,
            messageId: message.id,
            tool: { ...delegationView },
          });
          // No parent's reasoning or other modules' tool results cross into the specialist.
          // The original user request and attachments constrain the scope of delegated instructions.
          const user = ctx.session.messages.findLast((m) => m.role === "user")!;
          const history: AgentFrame["history"] = [
            {
              role: "user",
              content: `原用户请求（用户数据）：\n${options.registry.messageText(user)}\n\n主助手委派任务（不能扩大原请求授权）：\n${args.task}`,
            },
          ];
          options.host?.attachments?.append(
            history,
            (history[0] as { content: string }).content,
            user.attachments || [],
          );
          state.frames.push({
            agentId: child.agent.id,
            history,
            skills: [...child.skills],
            rounds: 0,
            calls: [],
            content: "",
            done: false,
            parentCallId: call.id,
          });
          await save();
          continue;
        } catch (error) {
          if (state.frames.at(-1) !== frame) throw error;
          output(frame, call, toolError(error));
          await save();
          continue;
        }
      }
      const result = await executeTool(current, run, message, call, writes, {
        save,
        clientTimeoutMs: options.clientToolTimeoutMs,
      });
      frame.skills = [...current.skills];
      output(frame, call, result);
      state.writes = [...writes];
      await save();
      continue;
    }
    const flow = state.workflow
      ? (frame.workflow ||= {
          phase: state.workflowEntry === "adaptive" ? "dispatch" : "analysis",
          reviews: 0,
        })
      : undefined;
    if (flow?.phase === "execution" && state.frames.length === 1) {
      const ownIds = new Set([
        ...(frame.receiptIds || []),
        ...frame.history.flatMap((item) =>
          item.type === "function_call" ? [item.call_id] : [],
        ),
      ]);
      const summary = receiptCompletion(
        flow.plan,
        message.toolCalls.filter((tool) => ownIds.has(tool.id)),
        ctx.session.calls,
        options.registry.tools,
      );
      if (summary) {
        frame.content = summary;
        frame.history.push({ role: "assistant", content: summary });
        frame.done = true;
        message.content = summary;
        const id = `${run.view.id}:receipt-answer`;
        timeline.text(id, "answer", summary, false);
        timeline.finishText(id);
        await save();
        continue;
      }
    }
    if (
      (!flow || flow.phase === "execution") &&
      (frame.rounds >=
        settingNumber(
          state.configuration,
          "ai.run.agentRounds",
          options.maxToolRounds ?? 8,
        ) ||
        state.totalRounds >=
          settingNumber(state.configuration, "ai.run.totalRounds", 24))
    )
      throw new ApiError(
        409,
        "TOOL_ROUND_LIMIT",
        "任务调用轮数已达上限，请结束后新建任务",
      );
    // Checkpoint before provider work; incomplete streaming output is never replayed as a committed turn.
    await save();
    let turnContent = "";
    // Earlier interruption notices remain in the timeline; a resumed final answer replaces the compatibility body.
    if (flow?.phase === "answer" && state.frames.length === 1)
      message.content = "";
    const messageContentBeforeTurn = message.content;
    let turnId: string = randomUUID();
    const textIds = new Set<string>();
    const reasoningIds = new Set<string>();
    const textKey = (id = "text") => `${turnId}:text:${id}`;
    const reasoningKey = (id: string) => `${turnId}:reasoning:${id}`;
    const visibleSize = () =>
      (message.timeline || []).reduce(
        (n, x) => n + (x.kind === "tool" ? 0 : x.text.length),
        0,
      );
    const recordUsage = async (
      usage: ProviderUsage,
      id: string,
      purpose: import("@t-box/shared").ModelCallPurpose,
    ) => {
      const calls = [
        ...(message.usage?.calls || []).filter((x) => x.id !== id),
        {
          id,
          agentId: frame.agentId,
          purpose,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens ?? null,
          cacheWriteTokens: usage.cacheWriteTokens ?? null,
          reasoningTokens: usage.reasoningTokens ?? null,
          totalTokens: usage.inputTokens + usage.outputTokens,
          durationMs: usage.durationMs ?? 0,
        },
      ];
      message.usage = {
        calls,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      };
      for (const call of calls) {
        message.usage.inputTokens += call.inputTokens;
        message.usage.outputTokens += call.outputTokens;
        message.usage.cachedInputTokens += call.cachedInputTokens ?? 0;
        message.usage.cacheWriteTokens =
          (message.usage.cacheWriteTokens ?? 0) + (call.cacheWriteTokens ?? 0);
        message.usage.reasoningTokens += call.reasoningTokens ?? 0;
        message.usage.totalTokens += call.totalTokens;
      }
      await save();
      ctx.session.send?.({
        type: "message.usage",
        runId: run.view.id,
        messageId: message.id,
        usage: structuredClone(message.usage),
      });
    };
    const catalog =
      flow?.phase === "analysis" || flow?.phase === "dispatch"
        ? await options.registry.planningCatalog(current)
        : [];
    frame.receiptIds = [
      ...new Set([
        ...(frame.receiptIds || []),
        ...frame.history.flatMap((item) =>
          item.type === "function_call" ? [item.call_id] : [],
        ),
      ]),
    ];
    const ownCalls = new Set(frame.receiptIds);
    const allReceipts = message.toolCalls.map((tool) => ({
      name: tool.name,
      result: ctx.session.calls.get(tool.id)?.result,
    }));
    const receipts = message.toolCalls
      .filter((tool) => ownCalls.has(tool.id))
      .map((tool) => ({
        name: tool.name,
        result: ctx.session.calls.get(tool.id)?.result,
      }));
    const businessTools = (await options.registry.availableTools(current))
      .filter((t) => !scope || scope.tools.has(t.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const baseInstructions = await options.registry.instructions(
      current,
      state.localDate,
      scope ? [scope.agent.moduleId] : state.applicationIds,
      flow?.phase ?? "execution",
    );
    const replyPhase = flow?.phase === "answer" || flow?.phase === "dispatch";
    const rootReply = state.frames.length === 1 && (!flow || replyPhase);
    const publicKind =
      replyPhase && state.frames.length === 1 ? "answer" : "analysis";
    let phaseTextId =
      flow && ["analysis", "review"].includes(flow.phase)
        ? `${turnId}:phase`
        : undefined;
    const publicText = (id: string, text: string, delta = true) => {
      const key = phaseTextId || id;
      textIds.add(key);
      timeline.text(
        key,
        publicKind,
        text,
        delta,
        flow && flow.phase !== "dispatch" ? phaseLabels[flow.phase] : undefined,
      );
    };
    const purpose =
      flow && flow.phase !== "execution" && flow.phase !== "dispatch"
        ? flow.phase
        : "response";
    const modelInput: ProviderInput = {
      configuration: state.configuration,
      execution: ctx.actor
        ? {
            userId: ctx.actor.user.id,
            taskId: options.host?.tasks ? run.view.id : undefined,
            operationId: turnId,
            messageId: message.id,
            agentId: frame.agentId,
            purpose,
          }
        : undefined,
      history:
        ctx.actor && options.host?.attachments
          ? await options.host.attachments.modelHistory(
              ctx.actor,
              frame.history,
            )
          : frame.history,
      tools: flow ? phaseTools(flow.phase, businessTools) : businessTools,
      toolChoice:
        flow?.phase === "analysis"
          ? { type: "function", name: "workflow_plan" }
          : flow?.phase === "review"
            ? { type: "function", name: "workflow_review" }
            : flow?.phase === "answer"
              ? "none"
              : "auto",
      publicReasoning: !flow,
      instructions:
        baseInstructions +
        (flow
          ? "\n" +
            phaseInstructions(state.workflow!, flow, catalog, {
              tools: receipts.map((receipt) => ({
                ...receipt,
                result: receiptEvidence(receipt.result),
              })),
              resources: message.attachments || [],
            })
          : ""),
      localDate: state.localDate,
      signal: run.abort.signal,
      onUsage: (usage) => recordUsage(usage, turnId, purpose),
      onDelta: (delta, itemId) => {
        if (run.abort.signal.aborted) return;
        if (
          turnContent.length + delta.length > 80_000 ||
          visibleSize() + delta.length > 400_000
        ) {
          run.abort.abort("OUTPUT_LIMIT");
          return;
        }
        turnContent += delta;
        // A final reply is one public stream even if a gateway emits multiple
        // message IDs or empty preliminary deltas. Keep provider items in history.
        const id = replyPhase ? textKey() : textKey(itemId);
        publicText(id, delta);
        if (rootReply) {
          message.content += delta;
          ctx.session.send?.({
            type: "assistant.delta",
            runId: run.view.id,
            messageId: message.id,
            delta,
          });
        }
      },
      onReasoning: (itemId, text, delta) => {
        if (flow || run.abort.signal.aborted) return;
        if (text.length > 80_000 || visibleSize() + text.length > 400_000) {
          run.abort.abort("OUTPUT_LIMIT");
          return;
        }
        const id = reasoningKey(itemId);
        reasoningIds.add(id);
        timeline.text(id, "reasoning", text, delta);
      },
    };
    const compactId = randomUUID();
    const contextId = `${compactId}:context`;
    const contextState = structuredClone(frame.contextState || {});
    const records = (frame.modelRequests ||= {});
    const request = <T>(
      method: string,
      input: ProviderInput,
      invoke: (input: ProviderInput) => Promise<T>,
      main = false,
    ) =>
      modelRequest(method, input, invoke, {
        records,
        save,
        onUsage: (usage, operationId) =>
          recordUsage(
            usage,
            operationId,
            input.execution?.purpose ?? (main ? purpose : "compaction"),
          ),
        onAttempt: main
          ? (operationId) => {
              turnId = operationId;
              phaseTextId =
                flow && ["analysis", "review"].includes(flow.phase)
                  ? `${turnId}:phase`
                  : undefined;
              turnContent = "";
              textIds.clear();
              reasoningIds.clear();
              if (phaseTextId) publicText(phaseTextId, "", false);
            }
          : undefined,
        onRetry: async (progress) => {
          if (main) {
            for (const id of textIds) {
              const item = message.timeline?.find((item) => item.id === id);
              if (item && item.kind !== "tool") {
                // A truncated reply is process evidence, not a second final answer.
                timeline.text(id, "analysis", item.text, false, "响应中断");
                timeline.finishText(id, undefined, "interrupted");
              }
            }
            for (const id of reasoningIds)
              timeline.finishText(id, undefined, "interrupted");
            if (rootReply) {
              message.content = messageContentBeforeTurn;
              ctx.session.send?.({
                type: "assistant.replace",
                runId: run.view.id,
                messageId: message.id,
                content: message.content,
              });
            }
          }
          const id = `${progress.id}:retry:${progress.attempt}`;
          timeline.text(
            id,
            "notice",
            `${progress.error.message}，${Math.ceil(progress.delayMs / 1000)} 秒后重试（${progress.attempt}/${progress.maxRetries}）。已完成的工具不会重新执行。`,
            false,
            "自动重试",
          );
          timeline.finishText(id);
        },
      });
    const contextProvider: ChatProvider = {
      mode: provider.mode,
      contextPolicy: provider.contextPolicy,
      maxOutputTokens: provider.maxOutputTokens,
      next: (input) => request("next", input, provider.next.bind(provider)),
      countInputTokens: provider.countInputTokens
        ? (input) =>
            request("count", input, provider.countInputTokens!.bind(provider))
        : undefined,
      summarize: provider.summarize
        ? (input) =>
            request("summary", input, provider.summarize!.bind(provider))
        : undefined,
      compact: provider.compact
        ? (input) => request("compact", input, provider.compact!.bind(provider))
        : undefined,
    };
    let context: Awaited<ReturnType<typeof prepareContext>>;
    try {
      context = await abortable(
        prepareContext(
          contextProvider,
          {
            ...modelInput,
            execution: modelInput.execution
              ? {
                  ...modelInput.execution,
                  operationId: compactId,
                  purpose: "compaction",
                }
              : undefined,
            onUsage: (usage) => recordUsage(usage, compactId, "compaction"),
          },
          {
            state: contextState,
            onUsage: (usage, operationId) =>
              recordUsage(usage, operationId, "compaction"),
            onProgress: async (progress) => {
              const qualifier = progress.estimated ? "估算 " : "";
              const text =
                progress.phase === "start"
                  ? "上下文接近预算，正在整理早期会话；保留最近请求与工具结果。"
                  : progress.phase === "progress"
                    ? `正在整理第 ${progress.part}/${progress.parts} 段历史，保留最近 ${progress.retainedTurns} 轮原文。`
                    : `上下文已整理：${qualifier}${progress.beforeTokens.toLocaleString()} → ${progress.afterTokens!.toLocaleString()} token。原始消息与执行记录保留。`;
              timeline.text(contextId, "analysis", text, false, "整理上下文");
              if (progress.phase === "completed")
                timeline.finishText(contextId);
              await save();
            },
          },
        ),
        run.abort.signal,
      );
    } catch (error) {
      if (message.timeline?.some((item) => item.id === contextId)) {
        timeline.text(
          contextId,
          "analysis",
          "上下文整理未完成，原始历史保留。",
          false,
          "整理上下文",
        );
        timeline.finishText(contextId, undefined, "interrupted");
      }
      throw error;
    }
    if (context.compacted) {
      const durableHistory =
        options.host?.attachments?.restoreContextReferences?.(
          frame.history,
          modelInput.history,
          context.history,
        ) ?? context.history;
      frame.history.splice(0, frame.history.length, ...durableHistory);
      frame.contextState = contextState;
      if (state.frames.length === 1) ctx.session.contextState = contextState;
      await save();
    }
    const turn = await abortable(
      request(
        "next",
        { ...modelInput, history: context.history },
        async (input) => {
          const turn = await provider.next(input);
          if (
            turn.calls.length > 8 ||
            JSON.stringify(turn.output).length > 400_000
          )
            throw new ApiError(
              502,
              "PROVIDER_OUTPUT_LIMIT",
              "模型返回超过大小限制",
            );
          return turn;
        },
        true,
      ),
      run.abort.signal,
    );
    run.abort.signal.throwIfAborted();
    if (turn.calls.length > 8 || JSON.stringify(turn.output).length > 400_000)
      throw new ApiError(502, "PROVIDER_OUTPUT_LIMIT", "模型返回超过大小限制");
    if (turn.calls.some((c) => !/^[-a-zA-Z0-9_]{1,100}$/.test(c.id)))
      throw new ApiError(
        502,
        "PROVIDER_CALL_INVALID",
        "模型返回无效的工具调用标识",
      );
    // Reconcile completed public output when a compatible service omits some/all deltas.
    // Encrypted reasoning stays exclusively in the internal provider history.
    const completedText: { id: string; text: string }[] = [];
    for (const [outputIndex, item] of turn.output.entries()) {
      if (item.type === "reasoning" && !flow) {
        for (const [index, part] of item.summary.entries()) {
          const id = reasoningKey(`${item.id}:${index}`);
          reasoningIds.add(id);
          timeline.text(id, "reasoning", part.text, false);
        }
      } else if ("role" in item && item.role === "assistant") {
        if (typeof item.content === "string") {
          completedText.push({
            id: textKey(`message:${outputIndex}`),
            text: item.content,
          });
        } else if (Array.isArray(item.content)) {
          for (const [index, part] of item.content.entries()) {
            if (part.type === "output_text" || part.type === "refusal")
              completedText.push({
                id: textKey(
                  `${"id" in item ? item.id : `message:${outputIndex}`}:${index}`,
                ),
                text: part.type === "output_text" ? part.text : part.refusal,
              });
          }
        }
      }
    }
    if (completedText.length) {
      const fullText = completedText.map((x) => x.text).join("\n");
      if (phaseTextId) publicText(phaseTextId, fullText, false);
      else if (replyPhase || textIds.has(textKey()))
        publicText(textKey(), fullText, false);
      // Chat adapters can stream a provider-specific item ID while their final
      // canonical message has no ID. Reuse the single stream item, not a second answer.
      else if (textIds.size === 1)
        publicText([...textIds][0]!, fullText, false);
      else
        for (const part of completedText) {
          textIds.add(part.id);
          publicText(part.id, part.text, false);
        }
      if (rootReply) {
        // Compatibility content contains every root turn, while the timeline is the authoritative UI.
        message.content =
          message.content.slice(
            0,
            message.content.length - turnContent.length,
          ) + fullText;
      }
      turnContent = fullText;
    }
    const finalTextId =
      !turn.calls.length && rootReply ? [...textIds].at(-1) : undefined;
    for (const id of textIds)
      timeline.finishText(
        id,
        id === finalTextId ||
          (flow?.phase === "dispatch" &&
            !turn.calls.length &&
            state.frames.length === 1)
          ? "answer"
          : "analysis",
      );
    for (const id of reasoningIds) timeline.finishText(id);
    // Provider receipts are temporary replay protection until this logical turn commits.
    delete frame.modelRequests;
    if (flow) {
      const phase = flow.phase;
      if (
        phase === "analysis" ||
        (phase === "dispatch" && turn.calls.length) ||
        phase === "review"
      ) {
        const available = new Set(
          catalog.flatMap((module) => module.tools.map((tool) => tool.name)),
        );
        if (phase === "analysis" || phase === "dispatch") {
          flow.plan = readPlan(turn.calls, available);
          flow.phase = flow.plan.route === "execute" ? "execution" : "answer";
          if (phase === "dispatch" && state.frames.length === 1)
            message.content = messageContentBeforeTurn;
        } else {
          flow.review = readReview(turn.calls);
          flow.reviews++;
          const missing = missingRequiredTools(flow.plan, allReceipts);
          if (flow.review.action === "complete" && missing.length) {
            flow.review = {
              action: "continue",
              summary: "必要工具尚未成功，继续核对执行结果。",
              next: `必须核对这些工具的真实结果：${missing.join("、")}。未尝试的按原授权执行；失败或不确定的不得盲目重试，必要时如实结束。`,
            };
          }
          if (
            flow.review.action === "continue" &&
            flow.reviews >=
              settingNumber(state.configuration, "ai.run.reviews", 3)
          )
            throw new ApiError(
              409,
              "WORKFLOW_REVIEW_LIMIT",
              "任务核对多次仍未完成，请检查工具执行结果",
            );
          flow.phase =
            flow.review.action === "continue" ? "execution" : "answer";
        }
        if (!turnContent.trim()) {
          const id = phaseTextId || `${turnId}:decision`;
          timeline.text(
            id,
            "analysis",
            phase !== "review" ? flow.plan!.summary : flow.review!.summary,
            false,
            phaseLabels[phase === "dispatch" ? "analysis" : phase],
          );
          timeline.finishText(id);
        }
        frame.history.push(...turn.output, {
          type: "function_call_output",
          call_id: turn.calls[0]!.id,
          output: JSON.stringify({
            ok: true,
            data: phase !== "review" ? flow.plan : flow.review,
          }),
        });
        await save();
        continue;
      }
      if (phase === "answer" || phase === "dispatch") {
        if (turn.calls.length)
          throw new ApiError(
            502,
            "WORKFLOW_UNEXPECTED_TOOL",
            "模型在最终回复阶段返回了工具调用，未执行",
          );
        if (!turnContent.trim())
          throw new ApiError(
            502,
            "PROVIDER_EMPTY_ANSWER",
            "模型未返回有效回复",
          );
        frame.content = turnContent;
        frame.history.push(...turn.output);
        frame.done = true;
        await save();
        continue;
      }
      flow.candidate = turnContent;
      if (!turn.calls.length) flow.phase = "review";
    }
    frame.rounds++;
    state.totalRounds++;
    if (!flow) frame.content += turnContent;
    frame.history.push(...turn.output);
    frame.calls = [...turn.calls];
    frame.done = !flow && !turn.calls.length;
    await save();
  }
}
