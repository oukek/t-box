const hints = {
  AccessDenied: '核对 Bucket 所属账号、RAM/桶策略的显式 Deny，以及 OSS 全局和 Bucket 的阻止公共访问设置；当前静态文件上传使用 public-read。',
  SignatureDoesNotMatch: '核对 GitHub Secrets 中的 AccessKey ID 与 Secret 是否为同一对，并检查 OSS_REGION。',
  InvalidAccessKeyId: '核对 GitHub Secret OSS_ACCESS_KEY_ID 是否正确且仍启用；确认它属于 Bucket 所在账号或已有跨账号授权。',
  InvalidSecurityToken: '临时 STS 凭据需要匹配的 OSS_SESSION_TOKEN；当前 Actions 使用长期 RAM AccessKey。',
  SecurityTokenExpired: '临时 STS 凭据已过期；更新凭据，或使用当前 Actions 要求的长期 RAM AccessKey。',
  NoSuchBucket: '目标 Bucket 不存在或地域不匹配；PM2 初始应用上传固定使用 tboxos-app，OSS_REGION 必须与该桶一致。',
  AuthorizationHeaderMalformed: '核对 OSS_REGION 与目标 Bucket 的实际地域，endpoint 由地域自动生成。',
  PermanentRedirect: '目标 Bucket 的 endpoint 不匹配；核对 OSS_REGION，不要填写服务器所在地域。',
  IncorrectEndpoint: '目标 Bucket 的 endpoint 不匹配；核对 OSS_REGION。',
  RequestTimeTooSkewed: '请求时间与 OSS 相差过大；检查执行机器的时钟同步。',
  InvalidDigest: '上传摘要格式无效；检查 Content-MD5 与 SDK 上传参数。',
  BadDigest: 'OSS 收到的数据与 Content-MD5 不一致；检查上传文件是否在传输过程中发生变化。',
  ENOTFOUND: '无法解析 OSS endpoint；核对地域、DNS 和执行环境网络。',
  EAI_AGAIN: 'OSS endpoint DNS 解析暂时失败；检查执行环境网络后重试。',
  ECONNRESET: '与 OSS 的连接被重置；检查执行环境到 OSS 的公网连接。',
  ETIMEDOUT: '连接 OSS 超时；检查公网 endpoint 和执行环境网络。',
  ConnectionTimeoutError: '连接 OSS 超时；检查公网 endpoint 和执行环境网络。',
  ResponseTimeoutError: '等待 OSS 响应超时；检查网络或稍后重试。',
  ENOENT: '本地待上传文件或下载目标目录不存在；检查打包产物和目录。',
  EACCES: '执行机器的本地文件权限不足；检查待上传文件或下载目录权限。',
  ENOSPC: '执行机器磁盘空间不足；清理临时目录后重试。',
}
const codes = new Set([
  ...Object.keys(hints),
  'AccessKeyIdAndSecurityTokenNotMatch',
  'NoSuchKey',
  'InvalidArgument',
  'InvalidRequest',
  'InvalidBucketName',
  'OperationDenied',
  'RequestTimeout',
  'RequestExpired',
  'NoSuchUpload',
  'Throttling',
  'TooManyRequests',
  'InternalError',
  'ServiceUnavailable',
  'ECONNREFUSED',
  'EPIPE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

/** Never serialize SDK messages, causes, request/response objects, signatures or credential fields. */
export function ossTransferError(operation, error, client, key) {
  const details = error && typeof error === 'object' ? error : {}
  const code = [details.code, details.name].find((value) => codes.has(value)) || 'UnknownError'
  const fields = [`code=${code}`]
  if (Number.isInteger(details.status) && details.status >= 100 && details.status <= 599) {
    fields.push(`HTTP=${details.status}`)
  }
  if (typeof details.requestId === 'string' && /^[a-f\d]{16,64}$/i.test(details.requestId)) {
    fields.push(`requestId=${details.requestId}`)
  }
  if (typeof details.ecCode === 'string' && /^\d{4}-\d{8}$/.test(details.ecCode)) {
    fields.push(`EC=${details.ecCode}`)
  }
  const { bucket, region } = client?.options || {}
  if (typeof bucket === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    fields.push(`bucket=${bucket}`)
  }
  if (typeof region === 'string' && /^oss-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region)) {
    fields.push(`region=${region}`)
  }
  if (typeof key === 'string' && key.length <= 1024 && /^[\w./@-]+$/.test(key)) {
    fields.push(`object=${key}`)
  }
  const hint = hints[code] || '根据错误码、HTTP 状态和 requestId 排查；不要仅凭通用提示判断为权限不足。'
  return new Error(`OSS ${operation} failed [${fields.join(', ')}]。${hint}`)
}
