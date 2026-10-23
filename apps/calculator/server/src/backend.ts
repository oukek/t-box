import type { ApplicationBackend } from '@t-box/app-server-sdk'
import { ApplicationErrorCode } from '@t-box/app-server-sdk'

import { runCalculation } from './service.js'

export const calculatorBackend: ApplicationBackend = {
  actions: [{ id: 'calculate', version: 1, title: '执行数学计算', description: '使用计算器已有计算引擎返回结果', inputSchema: { type: 'object' }, effect: 'read', background: true }],
  async lifecycle(request) {
    return {
      status: 'completed',
      receipt: {
        appId: request.appId,
        generation: request.generation,
        action: request.action,
      },
    }
  },
  async operation() {
    return null
  },
  async invoke(request, signal) {
    signal?.throwIfAborted()
    if (request.method !== 'calculate') {
      throw ApplicationErrorCode.APP_METHOD_NOT_FOUND('应用方法不存在')
    }
    return runCalculation(request.arguments)
  },
}
