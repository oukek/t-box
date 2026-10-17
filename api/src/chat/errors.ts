import { ApiError } from '@t-box/server-foundation/errors'
import OpenAI from 'openai'

export interface RunError {
  code: string
  message: string
  retryable: boolean
}
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[\w.-]{1,80}$/.test(value)
    ? value
    : undefined
// Provider-controlled code/param fields are untrusted too; a syntactically valid
// identifier may still be a model name, endpoint or credential.
const publicProviderCodes = new Set([
  'unsupported_parameter',
  'unsupported_value',
  'invalid_request_error',
  'invalid_api_key',
  'model_not_found',
  'context_length_exceeded',
  'rate_limit_exceeded',
  'rate_limit_error',
  'insufficient_quota',
  'content_filter',
  'content_policy_violation',
  'server_error',
  'upstream_error',
  'internal_error',
  'service_unavailable',
  'slow_down',
])
const publicProviderParameters = new Set([
  'model',
  'input',
  'messages',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'temperature',
  'top_p',
  'max_tokens',
  'max_output_tokens',
  'max_completion_tokens',
  'reasoning',
  'reasoning.effort',
  'reasoning.summary',
  'reasoning_effort',
  'stream',
  'stream_options',
  'response_format',
  'prompt_cache_key',
  'include',
  'store',
  'size',
  'quality',
  'image',
  'n',
])
/** Backend-only diagnostics: never serialize raw bodies, headers, stack traces or SQL. */
export function runErrorDiagnostics(error: unknown) {
  const value =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {}
  const status = value.status ?? value.statusCode
  const requestId = value.requestID
  const upstream =
    value.error && typeof value.error === 'object'
      ? (value.error as Record<string, unknown>)
      : value
  // Fixed categories aid diagnosis without logging an upstream free-form body.
  const message = typeof upstream.message === 'string' ? upstream.message : ''
  return {
    errorName:
      error instanceof OpenAI.APIError
        ? identifier(error.constructor.name)
        : identifier(value.name),
    internalCode: identifier(value.code),
    httpStatus:
      Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599
        ? Number(status)
        : undefined,
    providerRequestId:
      typeof requestId === 'string' &&
      /^[\w,. -]{1,256}$/.test(requestId)
        ? requestId
        : undefined,
    providerParameter: identifier(value.param),
    providerErrorCode: identifier(upstream.code),
    providerErrorType: identifier(upstream.type),
    providerFailureKind: /bad_response_status_code/i.test(message)
      ? 'upstream_status'
      : /^upstream request failed(?: for model [\w.:/-]+)?$/i.test(
        message.trim(),
      )
        ? 'upstream_failure'
        : undefined,
  }
}
/** Do not forward upstream bodies, request input, URLs, SQL or credentials to clients. */
export function publicRunError(
  error: unknown,
  abortReason?: unknown,
): RunError {
  const aborts: Record<string, RunError> = {
    SERVER_SHUTDOWN: {
      code: 'SERVER_SHUTDOWN',
      message: '服务正在重启，安全任务将从检查点自动继续',
      retryable: true,
    },
    TIMEOUT: { code: 'RUN_TIMEOUT', message: '任务执行超时', retryable: true },
    OUTPUT_LIMIT: {
      code: 'OUTPUT_LIMIT',
      message: '模型输出超过长度限制',
      retryable: false,
    },
    LEASE_LOST: {
      code: 'LEASE_LOST',
      message: '任务执行锁已失效，请重新连接',
      retryable: true,
    },
    CANCELLED: {
      code: 'RUN_CANCELLED',
      message: '任务已停止',
      retryable: false,
    },
    DISCONNECTED: {
      code: 'DISCONNECTED',
      message: '连接已断开',
      retryable: true,
    },
    CLIENT_REQUIRED: {
      code: 'CLIENT_REQUIRED',
      message: '等待前端操作，打开此对话后继续',
      retryable: true,
    },
  }
  if (aborts[String(abortReason)]) {
    return aborts[String(abortReason)]!
  }
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message.slice(0, 240),
      retryable: error.statusCode >= 500,
    }
  }
  const value =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {}
  const status = typeof value.status === 'number' ? value.status : undefined
  const code = identifier(value.code)
  const param = identifier(value.param)
  const publicCode = code && publicProviderCodes.has(code) ? code : undefined
  const publicParam = param && publicProviderParameters.has(param) ? param : undefined
  if (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') {
    return {
      code: 'TASK_STORAGE_BUSY',
      message: '任务存储繁忙，请稍后继续；已执行的操作请先核对',
      retryable: true,
    }
  }
  const upstream =
    value.error && typeof value.error === 'object'
      ? (value.error as Record<string, unknown>)
      : value
  const upstreamCode = identifier(upstream.code)
  const upstreamType = identifier(upstream.type)
  const quotaFailure =
    [
      'insufficient_quota',
      'organization_spend_limit_exceeded',
      'project_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
      'billing_hard_limit_reached',
    ].includes(upstreamCode || '') || upstreamType === 'insufficient_quota'
  if (quotaFailure) {
    return {
      code: 'PROVIDER_QUOTA',
      message: '模型服务额度不足，请检查服务商余额或限额',
      retryable: false,
    }
  }
  // SDK stream errors are APIError instances whose name can still be "Error".
  // SSE can carry an upstream failure after HTTP 200, without an HTTP status.
  if (
    error instanceof OpenAI.APIError &&
    !status &&
    [upstreamCode, upstreamType].some((x) =>
      [
        'upstream_error',
        'server_error',
        'internal_error',
        'service_unavailable',
        'rate_limit_error',
        'slow_down',
      ].includes(x || ''),
    )
  ) {
    return {
      code: 'PROVIDER_UPSTREAM_FAILED',
      message: '模型服务上游暂时异常',
      retryable: true,
    }
  }
  // Some gateways report an upstream failure as HTTP 400 without a code/param.
  // Recognize only this fixed envelope; never expose the provider's free-form body/model name.
  if (
    status &&
    !code &&
    !param &&
    typeof upstream.message === 'string' &&
    /^upstream request failed(?: for model [\w.:/-]+)?$/i.test(
      upstream.message.trim(),
    )
  ) {
    return {
      code: 'PROVIDER_UPSTREAM_FAILED',
      message: `服务商上游模型请求失败（${status}）`,
      retryable: status === 429 || status >= 500 || status === 408,
    }
  }
  if (value.name === 'SyntaxError') {
    return {
      code: 'PROVIDER_INVALID_JSON',
      message: '模型服务返回了无法解析的 JSON 数据',
      retryable: false,
    }
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      code: 'PROVIDER_TIMEOUT',
      message: '模型服务响应超时',
      retryable: true,
    }
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return {
      code: 'PROVIDER_CONNECTION',
      message: '模型服务连接失败',
      retryable: true,
    }
  }
  if (
    (error instanceof OpenAI.APIError || value.name === 'APIError') &&
    !status
  ) {
    return {
      code: code ? 'PROVIDER_FAILED' : 'PROVIDER_INVALID_RESPONSE',
      message: publicCode
        ? `模型响应失败（${publicCode}）`
        : '模型服务返回了不兼容的响应格式',
      retryable: false,
    }
  }
  const labels: Record<number, string> = {
    400:
      code === 'unsupported_parameter' || param
        ? '模型请求参数不兼容'
        : '模型服务拒绝请求',
    401: '模型服务鉴权失败',
    403: '模型服务拒绝访问',
    404: '模型或接口不存在',
    408: '模型请求超时',
    413: '模型请求超过大小限制',
    422: '模型请求参数无效',
    429: '模型服务限流或额度不足',
  }
  if (status) {
    return {
      code: publicCode || `PROVIDER_HTTP_${status}`,
      message: `${labels[status] || (status >= 500 ? '模型服务暂时异常' : '模型请求失败')}（${status}${publicCode ? ` / ${publicCode}` : ''}${publicParam ? ` · ${publicParam}` : ''}）`,
      retryable: status === 429 || status >= 500 || status === 408,
    }
  }
  if (
    value.name === 'APIConnectionTimeoutError' ||
    value.name === 'TimeoutError'
  ) {
    return {
      code: 'PROVIDER_TIMEOUT',
      message: '模型服务响应超时',
      retryable: true,
    }
  }
  let cause: unknown = error
  for (let i = 0; i < 4 && cause && typeof cause === 'object'; i++) {
    const c = cause as Record<string, unknown>
    if (
      [
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNRESET',
        'ETIMEDOUT',
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ].includes(String(c.code))
    ) {
      return {
        code: String(c.code),
        message: `无法连接模型服务（${c.code}）`,
        retryable: true,
      }
    }
    cause = c.cause
  }
  if (value.name === 'APIConnectionError') {
    return {
      code: 'PROVIDER_CONNECTION',
      message: '模型服务连接失败',
      retryable: true,
    }
  }
  return {
    code: 'RUN_INTERNAL_ERROR',
    message: '任务执行异常（RUN_INTERNAL_ERROR）',
    retryable: true,
  }
}
