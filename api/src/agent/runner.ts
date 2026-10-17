import type { ChatMessage, Resource, ResourceRef, TaskStatus } from '@t-box/shared'
import type { ChatProvider } from '../chat/provider.js'
import type { ChatSession, SessionRepository, SessionRun } from '../chat/session.js'
import type { RunCheckpoint } from './checkpoint.js'
import type { Actor, AgentRuntimeOptions, ToolContext } from './contracts.js'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  CHAT_LIMITS,
} from '@t-box/shared'
import { prepareAnswerRetry } from '../chat/answer-retry.js'
import { publicRunError, runErrorDiagnostics } from '../chat/errors.js'
import {
  snapshot,
} from '../chat/session.js'
import { settingNumber } from '../configuration/defaults.js'
import {
  captureSession,
  closeInterruptedHistory,
  restoreCheckpoint,
} from './checkpoint.js'
import {
  checkpointExecution,
  finishExecution,
  startExecution,
} from './execution-time.js'
import { portableHistory, rebuildConversationHistory } from './history.js'
import { requestClient } from './interaction.js'
import { orchestrate } from './orchestrator.js'
import { authorizedSnapshot } from './snapshot.js'
import { MessageTimeline } from './timeline.js'
import { generateConversationTitle } from './title.js'

export interface AgentRunInput {
  session: ChatSession
  requestId: string
  text: string
  localDate: string
  principal?: Actor
  bindings: ResourceRef[]
  attachments: Resource[]
  provider: ChatProvider
  applicationIds: string[]
  resume?: RunCheckpoint
  retry?: { assistantId: string }
  /** Server-only reservation, never part of model input or the public checkpoint. */
  recoveryClaim?: string
}
/** The local lock is synchronous; durable admission/claim happens before any application operation. */
export async function runConversation(
  options: AgentRuntimeOptions,
  sessions: SessionRepository,
  input: AgentRunInput,
) {
  const {
    session,
    requestId,
    text,
    localDate,
    principal,
    bindings,
    attachments,
    provider,
    applicationIds,
  } = input
  const before = structuredClone({
    session: captureSession(session),
    history: session.history,
  })
  let user: ChatMessage
  let assistant: ChatMessage
  let retryWrites: [string, import('@t-box/shared').ToolResult][] = []
  if (input.resume) {
    restoreCheckpoint(session, input.resume)
    user = session.messages.findLast((m) => m.role === 'user')!
    assistant = session.messages.find(
      (m) => m.id === input.resume!.assistantId,
    )!
    if (input.resume.execution) {
      assistant.execution = { ...input.resume.execution }
    }
  } else if (input.retry) {
    const prepared = prepareAnswerRetry(
      options,
      session,
      input.retry.assistantId,
      requestId,
    )
    user = prepared.user
    assistant = prepared.assistant
    retryWrites = prepared.writes
  } else {
    user = {
      id: randomUUID(),
      role: 'user',
      content: text,
      localDate,
      createdAt: new Date().toISOString(),
      toolCalls: [],
      attachments,
      applicationIds,
      resourceRefs: session.branch?.resourceRefs,
    }
    assistant = {
      id: randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      toolCalls: [],
    }
    session.messages.push(user, assistant)
    session.history.push({
      role: 'user',
      content: options.registry.messageText(user),
    })
    options.host?.attachments?.append(
      session.history,
      options.registry.messageText(user),
      attachments,
    )
    session.mode = provider.mode
    if (
      provider.configurationKey &&
      session.configurationKey !== provider.configurationKey
    ) {
      // A newly routed model must receive portable history, including durable tool receipts,
      // rather than opaque response IDs / native memory from another provider.
      const portable = portableHistory(session.history)
      session.history = portable ?? rebuildConversationHistory(
        session,
        options.registry,
        options.host?.attachments,
      )
      session.contextState = portable ? { ...session.contextState, lastAfterTokens: undefined } : {}
      session.configurationKey = provider.configurationKey
    }
  }
  if (input.resume) {
    new MessageTimeline(session, input.resume.runId, assistant).interrupt()
  }
  assistant.outcome = 'running'
  startExecution(assistant)
  delete assistant.error
  const run: SessionRun = {
    view: {
      id: input.resume?.runId || randomUUID(),
      requestId,
      assistantMessageId: assistant.id,
      status: 'running',
    },
    abort: new AbortController(),
  }
  session.active = run
  const initialAgent = options.registry.agentForApplications(applicationIds)
  const state: RunCheckpoint = input.resume || {
    capabilityLoading: options.capabilityLoading === 'deferred' ? 'deferred' : undefined,
    retry: input.retry,
    workflowEntry: 'adaptive',
    version: 1,
    registryRevision: options.registry.revision,
    modulePins: {},
    runId: run.view.id,
    requestId,
    localDate,
    applicationIds,
    bindings,
    assistantId: assistant.id,
    totalRounds: 0,
    delegations: 0,
    frames: [
      {
        capabilities: options.capabilityLoading === 'deferred' ? { loadedTools: [], applications: applicationIds } : undefined,
        agentId: initialAgent,
        history: session.history,
        contextState: (session.contextState ||= {}),
        skills: options.capabilityLoading === 'deferred'
          ? []
          : [
              ...(options.registry.agentScope(initialAgent)?.skills ||
                options.registry.initialSkills(applicationIds)),
            ],
        rounds: 0,
        calls: [],
        content: '',
        done: false,
      },
    ],
    writes: retryWrites,
    session: captureSession(session),
  }
  const tasks = principal ? options.host?.tasks : undefined
  const owner = randomUUID()
  let claimed = false
  let admitted = !tasks
  const memo = new Map<string, Promise<unknown>>()
  const ctx: ToolContext = {
    answerRetry: !!state.retry,
    registry: options.registry,
    skills: new Set(),
    bindings,
    actor: principal,
    session,
    requestId,
    signal: run.abort.signal,
    journal: tasks?.journal(run.view.id, owner),
    interact: (request) =>
      requestClient(
        session,
        run,
        randomUUID(),
        request,
        settingNumber(
          state.configuration,
          'ai.run.clientTimeoutMs',
          options.clientToolTimeoutMs ?? CHAT_LIMITS.clientToolTimeoutMs,
        ),
      ),
    use<T>(key: string, factory: () => Promise<T>) {
      if (!memo.has(key)) {
        memo.set(key, factory())
      }
      return memo.get(key)! as Promise<T>
    },
  }
  const save = async () => {
    checkpointExecution(assistant)
    state.execution = assistant.execution
      ? { ...assistant.execution }
      : undefined
    state.session = captureSession(session)
    if (tasks && claimed) {
      await tasks.checkpoint(
        run.view.id,
        owner,
        state,
        state.frames.at(-1)!.agentId,
      )
    }
    await options.host?.conversations?.save(
      session,
      tasks && claimed ? { taskId: run.view.id, owner } : undefined,
    )
  }
  let status: 'completed' | 'cancelled' | 'failed' = 'completed'
  let taskStatus: TaskStatus = 'completed'
  let reason: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    if (options.configuration && !state.configuration) {
      state.configuration = await options.configuration.snapshot()
    }
    ctx.configurationSnapshot = state.configuration
    timer = setTimeout(
      () => run.abort.abort('TIMEOUT'),
      settingNumber(
        state.configuration,
        'ai.run.timeoutMs',
        options.runTimeoutMs ?? CHAT_LIMITS.runTimeoutMs,
      ),
    )
    if (options.workflow && !state.workflow) {
      state.workflow = await options.workflow.snapshot()
    }
    if (tasks) {
      session.conversationId ||= randomUUID()
      if (!input.resume) {
        await tasks.create(
          principal!,
          run.view.id,
          session.conversationId,
          requestId,
          state,
          initialAgent,
          Boolean(session.archived),
          session.archiveRevision,
        )
      }
      await tasks.claim(principal!, run.view.id, owner, input.recoveryClaim)
      claimed = true
      admitted = true
      heartbeat = setInterval(() => {
        void tasks
          .guard(run.view.id, owner)
          .catch((error) =>
            run.abort.abort(
              error instanceof ApiError && error.code === 'TASK_CANCELLED'
                ? 'CANCELLED'
                : 'LEASE_LOST',
            ),
          )
      }, 25_000)
      session.task = (await tasks.get(principal!, run.view.id)).summary
    }
    run.abort.signal.throwIfAborted()
    session.send?.({
      type: 'run.started',
      run: { ...run.view },
      userMessage: structuredClone(user),
      assistantMessage: structuredClone(assistant),
    })
    await save()
    if (principal) {
      await options.registry.access.history(
        principal,
        session.messages,
        ctx.interact,
      )
    }
    session.send?.({
      type: 'session.snapshot',
      snapshot: snapshot(session, provider.mode),
    })
    await orchestrate(options, ctx, run, assistant, provider, state, save)
    await generateConversationTitle(
      options,
      session,
      principal,
      provider,
      run.abort.signal,
      state.configuration,
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TASK_CANCELLED') {
      run.abort.abort('CANCELLED')
    }
    const aborted = run.abort.signal.aborted
    status =
      aborted &&
      ['CANCELLED', 'DISCONNECTED'].includes(String(run.abort.signal.reason))
        ? 'cancelled'
        : 'failed'
    taskStatus =
      run.abort.signal.reason === 'CLIENT_REQUIRED'
        ? 'waiting_client'
        : run.abort.signal.reason === 'CANCELLED'
          ? 'cancelled'
          : 'paused'
    if (
      error instanceof ApiError &&
      ['TOOL_ROUND_LIMIT', 'TASK_STATE_LIMIT'].includes(error.code)
    ) {
      taskStatus = 'cancelled'
    }
    const failure = publicRunError(error, run.abort.signal.reason)
    if (!aborted && !(error instanceof ApiError)) {
      const phase = state.frames.at(-1)?.workflow?.phase
      const labels = {
        dispatch: '请求处理',
        analysis: '需求分析',
        execution: '任务处理',
        review: '结果核对',
        answer: '回复生成',
      }
      if (phase) {
        failure.message = `会话${labels[phase]}失败：${failure.message}`
      }
    }
    reason = failure.message
    assistant.error = failure
    try {
      options.onRunError?.({
        ...failure,
        runId: run.view.id,
        requestId,
        agentId: state.frames.at(-1)?.agentId || initialAgent,
        stage: state.frames.at(-1)?.workflow?.phase,
        diagnostics: runErrorDiagnostics(error),
      })
    } catch {
      /* Diagnostic sinks must not interrupt cleanup or persistence. */
    }
    if (!admitted) {
      Object.assign(session, before.session, {
        history: before.history,
        requests: new Map(before.session.requests) as ChatSession['requests'],
        calls: new Map(before.session.calls) as ChatSession['calls'],
      })
      if (!input.resume) {
        session.requests.delete(requestId)
      }
      session.send?.({
        type: 'error',
        code:
          error instanceof ApiError ? error.code : 'TASK_STORAGE_UNAVAILABLE',
        message:
          error instanceof ApiError
            ? error.message
            : '任务存储不可用，操作未执行',
        requestId,
      })
    } else {
      if (!tasks) {
        for (const frame of state.frames) {
          for (const call of frame.calls) {
            frame.history.push({
              type: 'function_call_output',
              call_id: call.id,
              output: JSON.stringify({
                ok: false,
                error: {
                  code: 'RUN_INTERRUPTED',
                  message: '任务已停止，工具未执行，请勿自动重试。',
                },
              }),
            })
          }
        }
      }
      const completedOperations = assistant.toolCalls.filter(
        (tool) =>
          tool.status === 'completed' &&
          options.registry.tools[tool.name]?.effect !== 'configuration' &&
          session.calls.get(tool.id)?.result?.ok,
      )
      const completedSummary = [
        ...new Set(
          completedOperations
            .map((tool) => options.registry.tools[tool.name]?.successSummary)
            .filter(Boolean),
        ),
      ]
        .slice(0, 3)
        .join('；')
        .slice(0, 240)
      const savedResult = completedSummary
        ? `${completedSummary}；已完成的结果已保留，不需要重新执行。`
        : ''
      const suffix =
        taskStatus === 'waiting_client'
          ? reason!
          : tasks && taskStatus !== 'cancelled'
            ? `${savedResult}${reason}。进度已保存${failure.retryable ? '，可继续任务' : '；请核对后再继续'}。`
            : status === 'cancelled'
              ? '任务已停止。已完成的操作不会回滚；请查看工具记录，勿重复提交已完成操作。'
              : `${savedResult}${reason}。已完成的操作不会回滚。`
      assistant.content += `${assistant.content ? '\n' : ''}${suffix}`
      if (!tasks) {
        session.history.push({ role: 'assistant', content: suffix })
      }
      if (taskStatus === 'cancelled') {
        closeInterruptedHistory(session)
        if (tasks) {
          session.history.push({ role: 'assistant', content: suffix })
        }
      }
    }
  } finally {
    clearTimeout(timer)
    clearInterval(heartbeat)
    finishExecution(assistant)
    assistant.outcome = ['paused', 'waiting_client'].includes(taskStatus)
      ? 'paused'
      : status
    const timeline = new MessageTimeline(session, run.view.id, assistant)
    timeline.interrupt()
    if (status !== 'completed' && admitted) {
      for (const tool of assistant.toolCalls) {
        if (tool.status === 'running' || tool.status === 'waiting_client') {
          if (
            taskStatus === 'waiting_client' &&
            tool.status === 'waiting_client'
          ) {
            tool.summary = '等待打开应用后处理'
          } else {
            tool.status = 'failed'
            tool.summary = reason || '执行已中断，请核对结果'
          }
          timeline.tool(tool)
        }
      }
      timeline.text(
        `notice:${randomUUID()}`,
        'notice',
        assistant.content.split('\n').at(-1) || reason || '任务已中断',
        false,
      )
      const notice = assistant.timeline!.at(-1)!
      timeline.finishText(notice.id)
    }
    // Dispatched SQL is awaited by executor even after cancellation; persist its result before releasing ownership.
    session.finishing = true
    session.active = undefined
    if (admitted && state.retry) {
      session.history = rebuildConversationHistory(
        session,
        options.registry,
        options.host?.attachments,
      )
      session.contextState = {}
    }
    sessions.touch(session)
    try {
      if (admitted && taskStatus === 'waiting_client' && tasks && claimed) {
        await save()
      } else if (admitted) {
        await options.host?.conversations?.save(
          session,
          tasks && claimed ? { taskId: run.view.id, owner } : undefined,
        )
      }
    } catch {
      status = 'failed'
      assistant.outcome = 'paused'
      taskStatus = 'paused'
      reason = '会话历史保存失败'
      assistant.content += '\n会话历史保存失败，请核对已执行的操作。'
      const noticeId = `notice:${randomUUID()}`
      timeline.text(
        noticeId,
        'notice',
        reason + '，请核对已执行的操作。',
        false,
      )
      timeline.finishText(noticeId)
    }
    if (tasks && claimed) {
      try {
        await tasks.finish(
          run.view.id,
          owner,
          taskStatus,
          reason,
          assistant.execution,
          run.abort.signal.reason === 'SERVER_SHUTDOWN',
          assistant,
        )
        session.task = (await tasks.get(principal!, run.view.id)).summary
      } catch {
        status = 'failed'
        assistant.outcome = 'failed'
        assistant.content += '\n任务状态保存失败，请恢复连接后核对工具记录。'
        const noticeId = `notice:${randomUUID()}`
        timeline.text(
          noticeId,
          'notice',
          '任务状态保存失败，请恢复连接后核对工具记录。',
          false,
        )
        timeline.finishText(noticeId)
      }
    }
    const finalSnapshot = await authorizedSnapshot(
      options,
      session,
      options.provider.mode,
      principal,
    )
    session.finishing = false
    session.send?.({
      type: 'run.finished',
      runId: run.view.id,
      status:
        taskStatus === 'waiting_client' &&
        session.task?.status !== 'needs_review'
          ? 'paused'
          : status,
      snapshot: finalSnapshot,
    })
  }
}
