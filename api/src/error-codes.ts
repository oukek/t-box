import {
  CommonErrorCode,
  defineApiErrors,
  defineInternalErrors,
} from '@t-box/errors'

const apiErrors = defineApiErrors({
  ALREADY_EXISTS: { statusCode: 409, message: '此记录已存在' },
  BAD_REQUEST: { statusCode: 400, message: '请求格式不正确，请使用 application/json' },
  PAYLOAD_TOO_LARGE: { statusCode: 413, message: '请求内容过大' },
  INTERNAL_ERROR: { statusCode: 500, message: '服务暂时不可用，请稍后重试' },
  NOT_FOUND: { statusCode: 404, message: '接口不存在' },
  ADMIN_NOT_FOUND: {
    statusCode: 404,
    message: '管理员不存在',
  },
  ADMIN_ORIGIN_REJECTED: {
    statusCode: 403,
    message: '此来源不允许访问管理后台',
  },
  AGENT_NOT_FOUND: {
    statusCode: 404,
    message: '专业助手不可用',
    variants: {
      invalid: {
        statusCode: 400,
        message: '专业 Agent 未注册',
      },
    },
  },
  AI_COST_LIMIT: {
    statusCode: 429,
    message: '已达到 AI 费用限额，请稍后重试',
  },
  AI_DISABLED: {
    statusCode: 503,
    message: '当前模型池或服务商不可用',
  },
  AI_DISCLOSURE_BLOCKED: {
    statusCode: 403,
    message: '已阻止包含内部信息的工具调用，请调整请求后重试',
  },
  AI_NOT_CONFIGURED: {
    statusCode: 503,
    message: '尚未接入 AI，请先在后台配置并启用普通会话模型。',
    variants: {
      invalid: {
        statusCode: 400,
        message: '尚未接入 AI，请在后台配置普通会话模型',
      },
    },
  },
  APP_ALREADY_INSTALLED: {
    statusCode: 409,
    message: '应用已经安装',
  },
  APP_ALREADY_REMOVED: {
    statusCode: 409,
    message: '应用已经卸载',
  },
  APP_ARTIFACT_DOWNLOAD_FAILED: {
    statusCode: 502,
    message: 'OSS 应用资源校验失败，请检查文件、域名与网络',
  },
  APP_ARTIFACT_UNAVAILABLE: {
    statusCode: 503,
    message: '此应用资源暂不可用，请重试或联系管理员检查部署',
  },
  APP_BACKEND_UNAVAILABLE: {
    statusCode: 502,
    message: '应用后端暂时不可用',
    variants: {
      unavailable: {
        statusCode: 503,
        message: '应用后端不可用',
      },
    },
  },
  APP_BUILD_CONFLICT: {
    statusCode: 409,
    message: '此版本已经提交其他构建，请使用新的版本号',
  },
  APP_BUILD_DOWNLOAD_FAILED: {
    statusCode: 502,
    message:
      'OSS 下载失败、对象不可读或构建超过 30 MB；请检查发布配置后重新提交',
  },
  APP_DEPLOYMENT_UNAVAILABLE: {
    statusCode: 503,
    message: '应用版本尚未部署或暂不可用',
  },
  APP_DRAFT_CHANGED: {
    statusCode: 409,
    message: '草稿已修改或已提交，请刷新',
  },
  APP_EVENTS_UNSUPPORTED: {
    statusCode: 409,
    message: '应用后端未提供此事件通道',
  },
  APP_IMPORT_FORBIDDEN: {
    statusCode: 403,
    message: '此凭证无权提交该应用',
  },
  APP_IMPORT_NOT_CONFIGURED: {
    statusCode: 503,
    message: '服务器 OSS 桶地址配置无效',
  },
  APP_IMPORT_UNAUTHORIZED: {
    statusCode: 401,
    message: '应用构建导入凭证无效',
  },
  APP_NOT_FOUND: {
    statusCode: 404,
    message: '应用未注册',
  },
  APP_NOT_INSTALLED: {
    statusCode: 403,
    message: '请先在市场安装此应用',
    variants: {
      conflict: {
        statusCode: 409,
        message: '请先安装应用',
      },
    },
  },
  APP_OPERATION_NOT_FOUND: {
    statusCode: 404,
    message: '应用操作不存在',
  },
  APP_OPERATION_PENDING: {
    statusCode: 409,
    message: '此应用有操作正在处理',
  },
  APP_PERMISSION_DENIED: {
    statusCode: 403,
    message: '此应用没有该操作权限',
  },
  APP_PERMISSION_REQUIRED: {
    statusCode: 400,
    message: '请确认此版本的应用权限',
    variants: {
      forbidden: {
        statusCode: 403,
        message: '此应用没有文件访问权限',
      },
    },
  },
  APP_PERMISSION_REVOKED: {
    statusCode: 403,
    message: '应用权限已撤销，请重新确认安装权限',
  },
  APP_PREPARATION_UNSUPPORTED: {
    statusCode: 409,
    message: '应用后端未提供执行前交互协议',
  },
  APP_PROTOCOL_INVALID: {
    statusCode: 502,
    message: '应用事件协议无效',
  },
  APP_PUBLICATION_CHANGED: {
    statusCode: 409,
    message: '线上版本已改变，请刷新后再确认发布',
  },
  APP_RELEASE_CHANGED: {
    statusCode: 409,
    message: '版本状态已改变，请刷新',
  },
  APP_RELEASE_LOCKED: {
    statusCode: 409,
    message: '只有待发布版本可以编辑更新信息',
  },
  APP_RELEASE_MISMATCH: {
    statusCode: 400,
    message: '应用版本不匹配',
  },
  APP_RELEASE_NOT_FOUND: {
    statusCode: 404,
    message: '版本不存在',
  },
  APP_RELEASE_NOT_SUBMITTED: {
    statusCode: 409,
    message: '请先提交版本，再发布',
  },
  APP_RELEASE_UNPUBLISHED: {
    statusCode: 409,
    message: '应用版本已下架',
  },
  APP_REQUEST_CONFLICT: {
    statusCode: 409,
    message: '操作标识已被其他请求使用',
  },
  APP_RUNTIME_EXPIRED: {
    statusCode: 409,
    message: '应用安装状态已改变，请重新打开',
  },
  APP_RUNTIME_UNSUPPORTED: {
    statusCode: 409,
    message: '应用不支持此运行环境',
  },
  APP_TOOL_UNAVAILABLE: {
    statusCode: 403,
    message: '此版本未提供该前端工具',
  },
  APP_USE_OSS_WORKFLOW: {
    statusCode: 409,
    message:
      '当前使用 OSS 静态发布，请通过应用发布工作流上传，再在后台审核上架',
  },
  APP_VERSION_EXISTS: {
    statusCode: 409,
    message: '此应用已存在该版本，请使用新的版本号',
  },
  APPLICATION_NOT_FOUND: {
    statusCode: 404,
    message: '应用尚未注册或不可用',
  },
  ATTACHMENTS_SIZE: {
    statusCode: 413,
    message: '每条消息的附件合计最多 20 MB',
  },
  AUTH_REQUIRED: {
    statusCode: 401,
    message: '请先登录',
  },
  AUTHORIZATION_CANCELLED: {
    statusCode: 403,
    message: '未授权，操作不会继续',
  },
  BALANCE_INSUFFICIENT: {
    statusCode: 402,
    message: '可用余额不足，请充值后继续；已完成的操作仍保留',
  },
  BALANCE_LIMIT: {
    statusCode: 400,
    message: '入账金额须为正数，且账户余额不能超出系统处理上限',
  },
  BILLING_IDENTITY_REQUIRED: {
    statusCode: 401,
    message: '请登录后使用 AI 会话',
  },
  CALL_ID_CONFLICT: {
    statusCode: 409,
    message: '工具调用标识冲突',
  },
  CAPABILITY_DISCOVERY_LIMIT: {
    statusCode: 409,
    message: '能力检索次数已达上限，请明确需要使用的应用或缩小任务范围',
  },
  CAPABILITY_NOT_LOADED: {
    statusCode: 403,
    message: '请先检索此应用的能力',
  },
  CHAT_HISTORY_INVALID: {
    statusCode: 409,
    message: '会话上下文包含不兼容或不完整的工具记录，请新建对话',
  },
  CLIENT_CAPABILITY_UNAVAILABLE: {
    statusCode: 409,
    message: '当前客户端不支持此操作，请更新应用',
  },
  COMPACTION_ATTACHMENT_INVALID: {
    statusCode: 502,
    message: '压缩结果中的附件无法关联原资源，已保留原上下文',
  },
  COMPACTION_DISABLED: {
    statusCode: 409,
    message: '服务商不支持上下文压缩',
  },
  COMPACTION_INVALID: {
    statusCode: 502,
    message: '服务商未返回有效的上下文压缩结果',
  },
  CONFIGURATION_CHANGED: {
    statusCode: 409,
    message: '配置已更新，请刷新后再保存',
  },
  CONFIGURATION_NOT_FOUND: {
    statusCode: 404,
    message: '配置项未注册或已移除',
  },
  CONFIGURATION_VERSION_NOT_FOUND: {
    statusCode: 404,
    message: '配置版本不存在',
  },
  CONTEXT_BUDGET_INVALID: {
    statusCode: 409,
    message: '总上下文窗口无法容纳输入和输出预算，请检查模型配置',
  },
  CONTEXT_COMPACTION_LIMIT: {
    statusCode: 409,
    message: '上下文压缩次数已达上限，请新建会话',
  },
  CONTEXT_ITEM_TOO_LARGE: {
    statusCode: 409,
    message:
      '某条历史消息或完整工具回执过大，无法安全生成摘要；请提高输入预算或新建会话',
  },
  CONTEXT_LATEST_TOO_LARGE: {
    statusCode: 409,
    message:
      '最新请求、附件或工具定义太大，无法通过压缩早期历史解决；请减少附件或提高有效输入预算',
  },
  CONTEXT_LIMIT: {
    statusCode: 409,
    message: '缺少可保留的用户请求，不能安全压缩',
  },
  CONTEXT_OPAQUE: {
    statusCode: 409,
    message:
      '已有服务商原生压缩记忆，请继续使用原生模式或新建会话后切换摘要模式',
  },
  CONTEXT_TOOL_PENDING: {
    statusCode: 409,
    message: '工具调用标识重复，不能压缩上下文',
  },
  CONVERSATION_BUSY: {
    statusCode: 409,
    message: '任务正在执行，不能覆盖会话记录',
  },
  CONVERSATION_NOT_FOUND: {
    statusCode: 404,
    message: '会话不存在',
    variants: {
      invalid: {
        statusCode: 400,
        message: '会话已删除，请新建会话',
      },
    },
  },
  CONVERSATION_STALE: {
    statusCode: 409,
    message: '会话已更新，请重新连接，已执行的操作保留',
  },
  CSRF_REJECTED: {
    statusCode: 403,
    message: '管理请求校验失败',
  },
  CURRENT_PASSWORD_INVALID: {
    statusCode: 400,
    message: '当前密码不正确',
  },
  CUSTOM_RECHARGE_DISABLED: {
    statusCode: 403,
    message: '自定义充值未开启，请选择已上架的充值套餐',
  },
  DELEGATION_LIMIT: {
    statusCode: 400,
    message: '专业 Agent 委派次数已达上限',
  },
  DESKTOP_APP_MISMATCH: {
    statusCode: 400,
    message: '排序须包含所有已安装应用，不能移除系统应用',
  },
  DESKTOP_APPEARANCE_CHANGED: {
    statusCode: 409,
    message: '壁纸已在其他设备更新，请重新加载后设置',
  },
  DESKTOP_CATALOG_CHANGED: {
    statusCode: 409,
    message: '应用列表已更新，请刷新桌面',
  },
  DESKTOP_LAYOUT_CHANGED: {
    statusCode: 409,
    message: '桌面已在其他窗口更新，请刷新后重新整理',
  },
  FILE_NOT_FOUND: {
    statusCode: 404,
    message: '文件不存在或未授权此应用访问',
  },
  HOST_UPDATE_REQUIRED: {
    statusCode: 409,
    message: '此版本需要先更新宿主应用或刷新网页，再更新应用',
  },
  IMAGE_DOWNLOAD_FAILED: {
    statusCode: 502,
    message: '无法下载服务商生成的图片，请检查图片地址是否可访问',
  },
  IMAGE_DOWNLOAD_REDIRECT: {
    statusCode: 502,
    message: '图片下载重定向次数过多或地址缺失',
  },
  IMAGE_DOWNLOAD_TIMEOUT: {
    statusCode: 502,
    message: '图片下载超时，生成结果需要核对',
  },
  IMAGE_OUTPUT_INVALID: {
    statusCode: 502,
    message: '服务商未返回有效图片',
  },
  IMAGE_OUTPUT_TOO_LARGE: {
    statusCode: 502,
    message: '生成图片超过 10 MB，无法保存',
  },
  IMAGE_PROVIDER_FAILED: {
    statusCode: 502,
    message: '图片服务请求失败，请稍后重试',
  },
  IMAGE_REQUIRED: {
    statusCode: 400,
    message: '编辑需要 1–4 张可访问的图片',
  },
  IMAGE_URL_BLOCKED: {
    statusCode: 502,
    message: '服务商图片地址指向非公网网络，已拒绝下载',
  },
  IMAGE_URL_INVALID: {
    statusCode: 502,
    message: '服务商返回的图片地址无效',
  },
  INTERACTION_IN_PROGRESS: {
    statusCode: 409,
    message: '已有一项客户端操作正在等待处理',
  },
  INVALID_APP_ARTIFACT: {
    statusCode: 400,
    message: 'OSS 应用产物不存在、不完整或摘要校验失败',
  },
  INVALID_APP_BUILD: {
    statusCode: 400,
    message: '应用构建信息无效',
  },
  INVALID_APP_EVENT: {
    statusCode: 400,
    message: '应用事件参数无效',
  },
  INVALID_APP_ID: {
    statusCode: 400,
    message: '应用标识无效',
  },
  INVALID_APP_INVOCATION: {
    statusCode: 400,
    message: '应用调用参数无效',
  },
  INVALID_APP_OPERATION: {
    statusCode: 400,
    message: '应用操作参数无效',
  },
  INVALID_APP_PUBLICATION: {
    statusCode: 400,
    message: '应用发布信息无效',
  },
  INVALID_APPLICATION: {
    statusCode: 400,
    message: '请选择已注册的应用，最多 4 个且不可重复',
  },
  INVALID_ARGUMENTS: {
    statusCode: 400,
    message: '工具参数过长',
  },
  INVALID_ATTACHMENTS: {
    statusCode: 400,
    message: '每条消息最多附加 4 个不同的文件',
  },
  INVALID_CONFIGURATION: {
    statusCode: 400,
    message: '配置格式不正确',
  },
  INVALID_CONTEXT_POLICY: {
    statusCode: 400,
    message: '上下文配置无效',
  },
  INVALID_COST_RESERVATION: {
    statusCode: 400,
    message: '成本预估无效',
  },
  INVALID_DESKTOP_DEVICE: {
    statusCode: 400,
    message: '请选择移动端或 PC 桌面',
  },
  INVALID_DESKTOP_LAYOUT: {
    statusCode: 400,
    message: '桌面排序格式无效',
  },
  INVALID_INVOCATION_MODE: {
    statusCode: 400,
    message: '调用方式与模型用途不匹配',
    variants: {
      unavailable: {
        statusCode: 503,
        message: '普通会话模型的调用方式配置无效',
      },
    },
  },
  INVALID_PAYMENT_CONFIG: {
    statusCode: 400,
    message: '支付开关无效',
  },
  INVALID_PAYMENT_MODE: {
    statusCode: 400,
    message: '支付方式无效',
  },
  INVALID_PLATFORM: {
    statusCode: 400,
    message: '应用或运行平台无效',
  },
  INVALID_PRICE: {
    statusCode: 400,
    message: '金额须为非负十进制字符串，最多 6 位小数',
  },
  INVALID_QUERY: {
    statusCode: 400,
    message: '查询参数无效',
  },
  INVALID_RECHARGE: {
    statusCode: 400,
    message: '充值金额须为 1–10000 元，最多 2 位小数',
  },
  INVALID_RECHARGE_CONFIG: {
    statusCode: 400,
    message: '充值配置无效',
  },
  INVALID_REQUEST_KEY: {
    statusCode: 400,
    message: '操作标识无效',
  },
  INVALID_RESULT_PATH: {
    statusCode: 400,
    message: '请使用 JSON Pointer 路径',
  },
  INVALID_SUPPORT_CONFIG: {
    statusCode: 400,
    message: '客服配置无效',
  },
  INVALID_TITLE: {
    statusCode: 400,
    message: '请填写会话标题',
  },
  INVALID_TOOL_RESULT: {
    statusCode: 400,
    message: '工具回执格式不正确',
  },
  INVALID_UPLOAD: {
    statusCode: 415,
    message: '请使用二进制文件上传',
  },
  INVALID_WALLPAPER: {
    statusCode: 400,
    message: '壁纸配置无效，请重新选择',
  },
  INVALID_WORKFLOW_PROMPTS: {
    statusCode: 400,
    message: '阶段 Prompt 格式不正确',
  },
  LOGIN_FAILED: {
    statusCode: 401,
    message: '账号或密码不正确，或账号已被锁定',
  },
  LOGIN_LIMIT: {
    statusCode: 429,
    message: '尝试次数过多，请 15 分钟后重试',
  },
  MESSAGE_COMMAND_LIMIT: {
    statusCode: 409,
    message: '消息调整次数达到上限，请新建会话',
  },
  MESSAGE_NOT_FOUND: {
    statusCode: 404,
    message: '这条消息已删除或不存在，请刷新对话',
  },
  MESSAGE_PAIR_INCOMPLETE: {
    statusCode: 409,
    message: '回复尚未保存完整，请稍后重试',
  },
  MESSAGE_PAIR_INVALID: {
    statusCode: 409,
    message: '消息缺少对应的问题，不能处理',
  },
  MESSAGE_ROLE_INVALID: {
    statusCode: 400,
    message: '只能修改用户发送的问题',
  },
  MODEL_CALL_NOT_FOUND: {
    statusCode: 404,
    message: '模型调用记录不存在',
  },
  MODEL_NOT_FOUND: {
    statusCode: 404,
    message: '模型配置不存在',
  },
  MODEL_POOL_UNAVAILABLE: {
    statusCode: 503,
    message: '模型池没有可用模型',
  },
  MODEL_PURPOSE_MISMATCH: {
    statusCode: 503,
    message: '模型用途与运行配置不匹配，请重新配置模型池',
  },
  MODEL_RETRIES_EXHAUSTED: {
    statusCode: 503,
    message: '模型请求重试次数已达上限，请稍后继续',
  },
  MODEL_TEST_FAILED: {
    statusCode: 502,
    message: '模型连通性测试失败',
  },
  MODEL_TOOL_UNSUPPORTED: {
    statusCode: 502,
    message: '模型未返回指定工具调用，请确认支持工具选择',
  },
  NOTIFICATION_NOT_FOUND: {
    statusCode: 404,
    message: '通知不存在',
  },
  OAUTH_EXPIRED: {
    statusCode: 400,
    message: '微信授权已过期，请从充值订单重新发起',
  },
  OAUTH_FAILED: {
    statusCode: 502,
    message: '微信网页授权失败，请重新发起支付',
  },
  OAUTH_INVALID: {
    statusCode: 400,
    message: '微信授权参数无效',
  },
  OAUTH_LIMIT: {
    statusCode: 429,
    message: '授权请求过多，请稍后再试',
  },
  OAUTH_UNAVAILABLE: {
    statusCode: 503,
    message: '公众号网页授权尚未配置',
  },
  ORDER_LIMIT: {
    statusCode: 429,
    message: '待支付订单过多，请先处理已有订单',
  },
  ORDER_NOT_FOUND: {
    statusCode: 404,
    message: '订单不存在',
  },
  ORDER_NOT_PAYABLE: {
    statusCode: 409,
    message: '订单已支付、关闭或过期',
  },
  ORDER_PAID: {
    statusCode: 409,
    message: '已支付订单不能关闭',
  },
  PAYMENT_BODY_INVALID: {
    statusCode: 415,
    message: '支付通知须使用 application/json 原始请求体',
  },
  PAYMENT_CONFIG_STALE: {
    statusCode: 409,
    message: '支付配置已修改，请刷新后重试',
  },
  PAYMENT_CONFLICT: {
    statusCode: 409,
    message: '订单支付流水不一致',
  },
  PAYMENT_INVALID: {
    statusCode: 400,
    message: '渠道通知无效',
  },
  PAYMENT_MISMATCH: {
    statusCode: 409,
    message: '渠道返回的订单不一致',
  },
  PAYMENT_MODE_DISABLED: {
    statusCode: 409,
    message: '当前客户端对应的支付方式尚未开放',
  },
  PAYMENT_MODE_LOCKED: {
    statusCode: 409,
    message: '此订单已使用另一种支付方式，请在原客户端继续，或关闭后重新充值',
  },
  PAYMENT_NOT_CONFIGURED: {
    statusCode: 503,
    message: '在线充值尚未开放，请稍后再试',
  },
  PAYMENT_SIGNATURE_INVALID: {
    statusCode: 400,
    message: '支付通知验签失败',
  },
  PROVIDER_BUSY: {
    statusCode: 429,
    message: '模型服务当前繁忙，请稍后继续；已完成的操作仍保留',
  },
  PROVIDER_CALL_INVALID: {
    statusCode: 502,
    message: '模型返回无效的工具调用标识',
  },
  PROVIDER_EMPTY_ANSWER: {
    statusCode: 502,
    message: '模型未返回有效回复',
  },
  PROVIDER_FAILED: {
    statusCode: 502,
    message: '模型响应标识不一致',
  },
  PROVIDER_INCOMPLETE: {
    statusCode: 502,
    message: '模型服务返回的内容不完整',
  },
  PROVIDER_LEASE_LOST: {
    statusCode: 503,
    message: '模型请求的执行租约已失效，用量保留待核对，请稍后继续',
  },
  PROVIDER_NOT_FOUND: {
    statusCode: 404,
    message: '服务商不存在',
  },
  PROVIDER_OUTPUT_LIMIT: {
    statusCode: 502,
    message: '模型返回超过大小限制',
  },
  PROVIDER_REFUSED: {
    statusCode: 502,
    message: '模型拒绝了本次请求',
  },
  PROVIDER_STREAM_CLOSED: {
    statusCode: 502,
    message: '模型连接提前结束，未获得完整响应',
  },
  PROVIDER_UNAVAILABLE: {
    statusCode: 502,
    message:
      '模型列表加载失败，请检查 API 地址、密钥和服务商的 /models 支持情况',
  },
  RATE_LIMIT: {
    statusCode: 429,
    message: '尝试次数过多，请稍后重试',
  },
  RECONCILIATION_CONFIGURATION: {
    statusCode: 400,
    message: '对账需要原商户配置',
  },
  RECONCILIATION_UNAVAILABLE: {
    statusCode: 503,
    message: '请先配置微信商户与对账权限',
  },
  RECOVERY_INVALID: {
    statusCode: 400,
    message: '账号或恢复码无效，恢复码可能已使用或已被更新',
  },
  REFUND_BALANCE_USED: {
    statusCode: 409,
    message: '可用余额不足以收回本次充值及赠送额度，请先核对已消费与预留费用',
  },
  REFUND_CONFLICT: {
    statusCode: 409,
    message: '退款终态不一致，请人工核对',
  },
  REFUND_EXISTS: {
    statusCode: 409,
    message: '此订单已有退款，请核对原退款单',
  },
  REFUND_INVALID: {
    statusCode: 400,
    message: '渠道退款信息无效',
  },
  REFUND_MISMATCH: {
    statusCode: 409,
    message: '渠道退款订单、金额或商户配置不一致',
  },
  REFUND_NOT_FOUND: {
    statusCode: 404,
    message: '退款单不存在',
  },
  REFUND_NOTIFICATION_INVALID: {
    statusCode: 400,
    message: '退款通知无效',
  },
  REFUND_ORDER_INVALID: {
    statusCode: 409,
    message: '仅已支付订单可申请退款',
  },
  REFUND_REASON: {
    statusCode: 400,
    message: '请填写退款原因，最多 80 个字节',
  },
  REFUND_WALLET_MISMATCH: {
    statusCode: 409,
    message: '退款余额预留不一致，请人工核对',
  },
  REFUNDS_UNAVAILABLE: {
    statusCode: 503,
    message: '渠道尚未配置退款能力',
  },
  REQUEST_ID_CONFLICT: {
    statusCode: 400,
    message: '同一请求 ID 不可用于不同消息',
    variants: {
      conflict: {
        statusCode: 409,
        message: '同一请求标识不能用于不同删除操作',
      },
    },
  },
  REQUEST_KEY_REQUIRED: {
    statusCode: 400,
    message: '请提供操作标识',
  },
  RESOURCE_LOCKED: {
    statusCode: 423,
    message: '资源授权尚未生效',
  },
  RESOURCE_MISSING: {
    statusCode: 404,
    message: '文件已不存在',
  },
  RESOURCE_QUOTA: {
    statusCode: 409,
    message: '资源空间已满（最多 500 个文件、300 MB）',
  },
  RESOURCE_SIZE: {
    statusCode: 413,
    message: '每个文件需为 1 字节至 10 MB',
  },
  RESOURCE_STORAGE_UNAVAILABLE: {
    statusCode: 503,
    message: '文件存储路径无效',
  },
  REVIEW_REQUIRED: {
    statusCode: 409,
    message: '仅可解除待核对记录的预留',
  },
  RUN_IN_PROGRESS: {
    statusCode: 400,
    message: '请等待生成结束后再删除',
    variants: {
      conflict: {
        statusCode: 409,
        message: '请等待当前任务结束',
      },
    },
  },
  RUN_NOT_FOUND: {
    statusCode: 400,
    message: '任务已结束或不存在',
  },
  SCHEMA_REQUIRED: {
    statusCode: 503,
    message: '请先初始化数据库',
  },
  SESSION_ALREADY_OPEN: {
    statusCode: 400,
    message: '此连接已绑定会话或正在建立会话',
  },
  SESSION_EXPIRED: {
    statusCode: 404,
    message: '会话已过期或服务已重启。请新建对话；已完成的操作仍然保留。',
  },
  SESSION_ID_INVALID: {
    statusCode: 400,
    message: '登录设备标识无效',
  },
  SESSION_IN_USE: {
    statusCode: 400,
    message: '此会话正在另一个连接中使用',
  },
  SESSION_INVALID: {
    statusCode: 400,
    message: '会话记录与恢复参数不一致',
    variants: {
      forbidden: {
        statusCode: 403,
        message: '会话恢复凭据无效',
      },
    },
  },
  SESSION_LIMIT: {
    statusCode: 400,
    message: '当前会话已达长度上限，请新建对话',
    variants: {
      limited: {
        statusCode: 429,
        message: '会话数量已达上限，请稍后再试',
      },
    },
  },
  SESSION_NOT_FOUND: {
    statusCode: 404,
    message: '设备登录已失效或不存在',
  },
  SESSION_REQUIRED: {
    statusCode: 400,
    message: '请先建立会话',
  },
  STATEMENT_DATE: {
    statusCode: 400,
    message: '请选择近 90 天内、今天之前的账单日期',
  },
  STATEMENT_EMPTY: {
    statusCode: 404,
    message: '渠道当日没有交易账单',
  },
  STATEMENT_INVALID: {
    statusCode: 502,
    message: '微信账单格式或金额无法校验，请核对原账单',
  },
  STATEMENT_MERCHANT: {
    statusCode: 502,
    message: '对账商户或日期不一致',
  },
  SUMMARY_INVALID: {
    statusCode: 502,
    message: '模型未返回有效的上下文摘要',
  },
  SUMMARY_TOO_LARGE: {
    statusCode: 502,
    message: '上下文摘要未满足大小要求，原始上下文已保留，可继续任务',
  },
  SUMMARY_UNSUPPORTED: {
    statusCode: 409,
    message: '服务商不支持摘要压缩',
  },
  SYSTEM_APP_REQUIRED: {
    statusCode: 403,
    message: '系统应用不能卸载',
  },
  TASK_APP_CHANGED: {
    statusCode: 409,
    message: '任务使用的应用版本或安装状态已改变，请核对后重新发起',
  },
  TASK_CANCELLED: {
    statusCode: 409,
    message: '任务已结束',
  },
  TASK_CAPABILITIES_CHANGED: {
    statusCode: 409,
    message: '任务的应用或技能版本已改变，请核对后结束旧任务',
  },
  TASK_CHANGED: {
    statusCode: 409,
    message: '旧任务状态已改变，请刷新后重试',
  },
  TASK_CONVERSATION_MISMATCH: {
    statusCode: 400,
    message: '请打开此任务所属会话后继续',
  },
  TASK_IDENTITY_CHANGED: {
    statusCode: 403,
    message: '任务身份已改变，请重新打开会话',
  },
  TASK_IN_PROGRESS: {
    statusCode: 409,
    message: '后端正在执行，请等待任务结束或先停止',
  },
  TASK_LEASE_LOST: {
    statusCode: 409,
    message: '工具执行结果未能持久保存，请核对操作',
  },
  TASK_MODEL_CHANGED: {
    statusCode: 409,
    message: '任务原模型已移出模型池或停用，请恢复原模型配置后继续',
  },
  TASK_NOT_CANCELLABLE: {
    statusCode: 409,
    message: '任务已结束或不存在',
  },
  TASK_NOT_FOUND: {
    statusCode: 404,
    message: '任务不存在',
  },
  TASK_NOT_RESUMABLE: {
    statusCode: 409,
    message: '此任务不能继续，结果不确定的操作请先核对',
  },
  TASK_STATE_LIMIT: {
    statusCode: 413,
    message: '任务上下文过大，请结束任务后新建会话',
  },
  TASK_VERSION_MISMATCH: {
    statusCode: 409,
    message: '任务格式不兼容，请核对后结束任务',
  },
  TASKS_UNAVAILABLE: {
    statusCode: 400,
    message: '持久任务服务不可用',
    variants: {
      unavailable: {
        statusCode: 503,
        message: '持久任务服务不可用',
      },
    },
  },
  TOKEN_COUNT_INVALID: {
    statusCode: 502,
    message: '服务商返回了无效的上下文 token 计数',
  },
  TOKEN_COUNT_UNSUPPORTED: {
    statusCode: 409,
    message: '服务商不支持输入 token 计数',
  },
  TOOL_ALREADY_DISPATCHED: {
    statusCode: 409,
    message: '同一工具操作已提交，不能重复执行',
  },
  TOOL_APPLICATION_LIMIT: {
    statusCode: 400,
    message: '请分批加载更少应用的工具',
  },
  TOOL_INSTRUCTIONS_LIMIT: {
    statusCode: 400,
    message: '活动技能指导超出预算，请减少工具或由应用拆分技能',
  },
  TOOL_LOAD_LIMIT: {
    statusCode: 400,
    message: '请分批加载所需工具',
  },
  TOOL_NOT_ALLOWED: {
    statusCode: 403,
    message: '工具不可用或超出当前助手范围',
    variants: {
      invalid: {
        statusCode: 400,
        message: '工具未注册或尚未启用',
      },
    },
  },
  TOOL_NOT_LOADED: {
    statusCode: 403,
    message: '请先检索或加载此工具',
  },
  TOOL_OUTCOME_UNCERTAIN: {
    statusCode: 409,
    message: '工具结果需要核对，禁止自动重复写入',
  },
  TOOL_RESULT_DENIED: {
    statusCode: 403,
    message: '不可读取此应用回执',
  },
  TOOL_RESULT_NOT_FOUND: {
    statusCode: 404,
    message: '来源消息已不存在，不能读取此回执',
  },
  TOOL_RESULT_PATH_NOT_FOUND: {
    statusCode: 404,
    message: '回执字段不存在',
  },
  TOOL_ROUND_LIMIT: {
    statusCode: 409,
    message: '任务调用轮数已达上限，请结束后新建任务',
  },
  TOOL_SCHEMA_LIMIT: {
    statusCode: 400,
    message: '工具定义超出加载预算，请减少工具数量或调整后台预算',
  },
  UNAUTHENTICATED: {
    statusCode: 401,
    message: '请重新登录',
  },
  UNSUPPORTED_RESOURCE: {
    statusCode: 415,
    message: '支持 PNG、JPEG、WebP、PDF 和 UTF-8 文本文件',
  },
  USAGE_CONFLICT: {
    statusCode: 409,
    message: '重复用量与已结算记录不一致',
  },
  USAGE_INVALID: {
    statusCode: 502,
    message: '服务商返回的用量无效，费用待核对',
  },
  USAGE_MISSING: {
    statusCode: 502,
    message: '服务商未返回有效用量，本次费用待核对；不会自动重试',
  },
  USAGE_NOT_FOUND: {
    statusCode: 404,
    message: '费用记录不存在',
  },
  USAGE_RELEASED: {
    statusCode: 409,
    message: '该记录已人工解除，需人工核对费用',
  },
  USAGE_REPLAY: {
    statusCode: 409,
    message: '本次调用已记录，请先核对执行结果',
  },
  USAGE_REVIEW: {
    statusCode: 402,
    message: '本次用量超出可用余额，费用已保留待核对；不会重复调用',
  },
  USAGE_UNKNOWN: {
    statusCode: 409,
    message: '尚未取得实际用量，请先核对服务商记录，或解除预留并放弃本次扣费',
  },
  USER_DECLINED: {
    statusCode: 400,
    message: '用户未确认，操作未执行',
  },
  VISION_MODEL_REQUIRED: {
    statusCode: 409,
    message: '当前普通会话模型未启用看图能力，请在后台启用看图或切换模型',
    variants: {
      unavailable: {
        statusCode: 503,
        message: '当前模型池没有可用的看图模型，请在后台配置',
      },
    },
  },
  WALLPAPER_RESOURCE_UNAVAILABLE: {
    statusCode: 400,
    message: '壁纸图片不存在、已删除或不属于当前账号',
  },
  WECHAT_UNAVAILABLE: {
    statusCode: 502,
    message: '微信支付服务暂不可用',
  },
  WORKFLOW_CONFIG_CHANGED: {
    statusCode: 409,
    message: '配置已更新，请刷新后再保存',
  },
  WORKFLOW_CONFIG_REQUIRED: {
    statusCode: 503,
    message: '请先初始化分析流程数据库',
  },
  WORKFLOW_DECISION_INVALID: {
    statusCode: 502,
    message: '模型未返回有效的阶段决定，请确认会话模型支持工具选择',
  },
  WORKFLOW_REVIEW_LIMIT: {
    statusCode: 409,
    message: '任务核对多次仍未完成，请检查工具执行结果',
  },
  WORKFLOW_UNEXPECTED_TOOL: {
    statusCode: 502,
    message: '模型在最终回复阶段返回了工具调用，未执行',
  },
})
const internalErrors = defineInternalErrors('API', {
  INTERNAL_INVALID_ENVIRONMENT_VALUE: '运行环境配置值无效',
  INTERNAL_DATABASE_SCHEMA_INCOMPLETE: '数据库初始化结构不完整',
  INTERNAL_INVALID_INITIALIZATION_ARGUMENTS:
    'Usage: node dist/init-db.js [--check]',
  INTERNAL_AGENT_SKILLS_MUST_BELONG_TO_ITS_MODULE: '专业助手只能使用所属应用的技能',
  INTERNAL_IMPORT_ADMIN_REQUIRED:
    'An enabled administrator is required before import credential synchronization',
  INTERNAL_APP_ARTIFACT_ORIGIN_MUST_BE_A_SEPARATE_HTTPS_ORIGIN_IN_PRODUCTION:
    'APP_ARTIFACT_ORIGIN must be a separate HTTPS origin in production',
  INTERNAL_APP_IMPORT_TOKEN_HAS_BEEN_REVOKED_CONFIGURE_A_NEW_TOKEN:
    'APP_IMPORT_TOKEN has been revoked; configure a new token',
  INTERNAL_IMPORT_TOKEN_REUSED:
    'APP_IMPORT_TOKEN was already used by another credential; configure a new token',
  INTERNAL_APPLICATION_ARTIFACT_DIGEST_DOES_NOT_MATCH_DEPLOYMENT:
    'Application artifact digest does not match deployment',
  INTERNAL_APPLICATION_RESPONSE_TOO_LARGE: 'Application response too large',
  INTERNAL_CACHE_TIMEOUT: 'CACHE_TIMEOUT',
  INTERNAL_CONFIGURE_OSS_CREDENTIALS_BEFORE_MIGRATING_LOCAL_FILES:
    'Configure OSS credentials before migrating local files',
  INTERNAL_DATABASE_BASELINE_MISMATCH:
    '数据库初始化版本与当前代码不一致，不能覆盖已有结构。请使用匹配的发布版本或正式升级脚本。',
  INTERNAL_DATABASE_INITIALIZATION_BUSY: '无法获取数据库初始化锁，请稍后重试',
  INTERNAL_DELEGATION_MUST_BE_HANDLED_BY_THE_ORCHESTRATOR:
    'Delegation must be handled by the orchestrator',
  INTERNAL_DOWNLOAD: 'download',
  INTERNAL_DUPLICATE_BACKEND_BINDING: 'Duplicate backend binding',
  INTERNAL_DUPLICATE_MODULE: '应用模块重复注册',
  INTERNAL_DUPLICATE_RESOURCE_ADAPTER: '资源适配器重复注册',
  INTERNAL_DUPLICATE_SKILL: '技能重复注册',
  INTERNAL_EMPTY_APPLICATION_RESPONSE: 'Empty application response',
  INTERNAL_ENABLED_ADMINISTRATOR_NOT_FOUND: 'Enabled administrator not found',
  INTERNAL_ENCRYPTED_PAYMENT_RESOURCE_HAS_NO_PAYLOAD:
    'Encrypted payment resource has no payload',
  INTERNAL_EXISTING_DATABASE_UNRECOGNIZED:
    '当前数据库已有旧表或未识别的结构，初始化已停止，未清空数据。请将 MYSQL_DATABASE 指向一个新数据库后重试；旧库请先备份，有数据的库不能用首次初始化代替升级。详见 docs/database-initialization.md。',
  INTERNAL_HOST_PORT: 'HOST 或 PORT 配置无效',
  INTERNAL_IMMUTABLE_RELEASE_CHANGED: '已提交的应用版本定义已被修改',
  INTERNAL_INVALID_ADDRESS: 'invalid address',
  INTERNAL_INVALID_ADMIN_ORIGINS:
    'ADMIN_ORIGINS 必须是完整的 HTTPS 后台来源，不包含路径或通配符',
  INTERNAL_INVALID_APPLICATION_BOOTSTRAP_METADATA:
    'Invalid application bootstrap metadata',
  INTERNAL_INVALID_APPLICATION_DEPLOYMENT_CONFIGURATION:
    'Invalid application deployment configuration',
  INTERNAL_INVALID_APPLICATION_MODULE: '应用模块定义无效',
  INTERNAL_INVALID_CONFIGURATION_KEY: 'Invalid configuration key',
  INTERNAL_INVALID_DATABASE_NAME: 'MYSQL_DATABASE 只能包含字母、数字和下划线',
  INTERNAL_INVALID_DELEGATION_CHECKPOINT: 'Invalid delegation checkpoint',
  INTERNAL_INVALID_DEPLOYMENT_IMPORT_CREDENTIAL_DIGEST_OR_APPLICATION_SCOPE:
    'Invalid deployment import credential digest or application scope',
  INTERNAL_INVALID_DUPLICATE_AGENT: '专业助手定义无效或重复',
  INTERNAL_INVALID_DUPLICATE_CLIENT_INTERACTION: '前端交互定义无效或重复',
  INTERNAL_INVALID_DUPLICATE_TOOL: '工具定义无效或重复',
  INTERNAL_INVALID_ENCRYPTED_CREDENTIAL: 'Invalid encrypted credential',
  INTERNAL_INVALID_LIFECYCLE_RECEIPT: 'Invalid lifecycle receipt',
  INTERNAL_INVALID_MODEL_LIST: 'invalid model list',
  INTERNAL_INVALID_OR_DUPLICATE_TABLE_IN_SCHEMA: '数据库表定义无效或重复',
  INTERNAL_INVALID_PM2_RELEASE_CONFIGURATION:
    'Invalid PM2 release configuration',
  INTERNAL_INVALID_PUBLIC_HTTPS_URL: 'Invalid public HTTPS URL',
  INTERNAL_INVALID_TOOL_NAME: '工具名称格式无效',
  INTERNAL_INVALID_VAULT_KEY: 'Invalid vault key',
  INTERNAL_INVALID_WECHAT_OAUTH_RESPONSE: 'Invalid Wechat OAuth response',
  INTERNAL_LOCAL_CLEANUP_REFUSED_STORED_OBJECT_DIFFERS_FROM_ITS_OSS_COPY:
    'Local cleanup refused: stored object differs from its OSS copy',
  INTERNAL_MANIFEST_SKILLS_MUST_BELONG_TO_THEIR_MODULE: '应用清单只能引用所属应用的技能',
  INTERNAL_MISSING_CLIENT_PARSER: '前端工具缺少参数解析器',
  INTERNAL_MISSING_HANDLER: '后端工具缺少处理函数',
  INTERNAL_MISSING_OR_CIRCULAR_SCHEMA_DEPENDENCY: '数据库表依赖缺失或存在循环',
  INTERNAL_MISSING_WRITE_FINGERPRINT: '写入工具缺少幂等参数指纹',
  INTERNAL_ONLY_CONFIGURATION_TOOLS_MAY_RESTORE_LOCAL_STATE: '只有配置工具可以恢复本地状态',
  INTERNAL_OSS_APPLICATIONS_REQUIRE_AN_EXACT_PUBLIC_HTTPS_ORIGIN:
    'OSS applications require an exact public HTTPS origin',
  INTERNAL_OSS_CONFIGURATION_REQUIRED:
    '业务文件 OSS 配置不完整：请设置 OSS_REGION、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET（Bucket 默认 tboxos）',
  INTERNAL_OSS_DELIVERY_REQUIRED:
    '生产环境必须使用 OSS 应用交付，不能在服务器持久保存应用文件',
  INTERNAL_OSS_MIGRATION_CONTENT_VERIFICATION_FAILED:
    'OSS migration content verification failed',
  INTERNAL_PAYMENT_KEYS_MUST_USE_RSA_WITH_AT_LEAST_2048_BITS:
    'Payment keys must use RSA with at least 2048 bits',
  INTERNAL_PAYMENT_PRIVATE_KEY_FAILED_SIGNATURE_VERIFICATION:
    'Payment private key failed signature verification',
  INTERNAL_PRODUCTION_ARTIFACT_ORIGIN_REQUIRED:
    'Production application deployment requires a configured HTTPS artifact origin',
  INTERNAL_PRODUCTION_APPLICATION_FILES_MUST_BE_STORED_IN_OSS:
    'Production application files must be stored in OSS',
  INTERNAL_PRODUCTION_BOOTSTRAP_REQUIRED:
    'Production OSS deployment requires the trusted bootstrap digest and HTTPS origin',
  INTERNAL_PROVIDE_EXPLICIT_APP_IDS_AND_EXPIRY_FROM_1_TO_365_DAYS:
    'Provide explicit app IDs and expiry from 1 to 365 days',
  INTERNAL_PROVIDER_ENCRYPTION_KEY_MUST_CONTAIN_32_BYTES:
    'Provider encryption key must contain 32 bytes',
  INTERNAL_PUBLIC_TIMELINE_OUTPUT_LIMIT: 'Public timeline output limit',
  INTERNAL_REDIS_UNAVAILABLE: 'Redis unavailable',
  INTERNAL_REMOTE_APPLICATIONS_REQUIRE_HTTPS_OR_LOOPBACK_DEVELOPMENT_ENDPOINT:
    'Remote applications require HTTPS or loopback development endpoint',
  INTERNAL_REMOTE_SERVICE_CREDENTIAL_IS_REQUIRED:
    'Remote service credential is required',
  INTERNAL_RESOLVE_A_DATABASE_PROVIDER_BEFORE_RUNNING:
    'Resolve a database provider before running',
  INTERNAL_RESOURCE_ADAPTER_MUST_BELONG_TO_ITS_MODULE: '资源适配器必须归属于当前应用',
  INTERNAL_RESOURCE_STORAGE_IDS_MUST_BE_UNIQUE_AND_IMMUTABLE:
    'Resource storage IDs must be unique and immutable',
  INTERNAL_SIZE: 'size',
  INTERNAL_SKILL_TOOLS_MUST_BELONG_TO_THEIR_MODULE: '技能只能引用所属应用的工具',
  INTERNAL_TIMELINE_ITEM_TYPE_CONFLICT: 'Timeline item type conflict',
  INTERNAL_TITLE_GENERATION_STOPPED: 'Title generation stopped',
  INTERNAL_TITLE_RESPONSE_INCOMPLETE: 'Title response incomplete',
  INTERNAL_UNABLE_TO_LOCK_ADMINISTRATOR_BOOTSTRAP:
    'Unable to lock administrator bootstrap',
  INTERNAL_UNABLE_TO_LOCK_MANAGED_IMPORT_CREDENTIAL_SYNCHRONIZATION:
    'Unable to lock managed import credential synchronization',
  INTERNAL_UNKNOWN_SKILL_IN_APP: '应用引用了未注册技能',
  INTERNAL_UNKNOWN_TOOL_IN_SKILL: '技能引用了未注册工具',
  INTERNAL_UNSUPPORTED_APPLICATION_CONTRACT: '应用协议版本不受支持',
  INTERNAL_USAGE_NODE_MIGRATE_LOCAL_JS_LOCAL_RESOURCE_DIRECTORY:
    'Usage: node migrate-local.js [LOCAL_RESOURCE_DIRECTORY]',
  INTERNAL_IMPORT_CREDENTIAL_USAGE:
    'Usage: sync (SHA-256 on stdin) | create <administrator username> <appId,appId> [expiryDays=90] | revoke <credentialId>',
  INTERNAL_USER_BOOTSTRAP_BUSY: '无法获取初始普通用户创建锁，请稍后重试',
})

export const ErrorCode = Object.freeze({ ...CommonErrorCode, ...apiErrors, ...internalErrors })
