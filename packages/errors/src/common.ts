import { defineApiErrors } from './factories.js'

/** Cross-domain protocol errors. Each code is registered exactly once. */
export const CommonErrorCode = defineApiErrors({
  VALIDATION_ERROR: {
    statusCode: 400,
    message: '请检查填写的内容',
  },
  CATEGORIES_UNAVAILABLE: {
    statusCode: 503,
    message: '分类服务不可用',
  },
  CONNECTION_LIMIT: {
    statusCode: 429,
    message: '连接数量已达上限',
  },
  IDEMPOTENCY_CONFLICT: {
    statusCode: 409,
    message: '重复请求参数不一致',
  },
  IDEMPOTENCY_REQUIRED: {
    statusCode: 400,
    message: '请提供有效的 Idempotency-Key',
  },
  IMAGE_MODEL_REQUIRED: {
    statusCode: 503,
    message: '请在后台配置图片生成/编辑模型',
  },
  INVALID_CONFIG: {
    statusCode: 400,
    message: '密码长度需为 6–128 个字符',
  },
  INVALID_EVENT: {
    statusCode: 400,
    message: '请求标识格式不正确',
  },
  INVALID_SCOPE: {
    statusCode: 400,
    message: '资源作用域应为最多 16 个资源的数组',
  },
  ORIGIN_NOT_ALLOWED: {
    statusCode: 403,
    message: '此网页来源不允许连接',
  },
  RESOURCE_NOT_FOUND: {
    statusCode: 404,
    message: '文件不存在',
  },
  RESOURCE_UNAVAILABLE: {
    statusCode: 503,
    message: '资源服务不可用',
    variants: {
      forbidden: {
        statusCode: 403,
        message: '资源应用未注册或已停用',
      },
    },
  },
  STALE_REVISION: {
    statusCode: 409,
    message: '事件已更新，请刷新后重试',
  },
})
