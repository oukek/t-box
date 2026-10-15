export interface OperationsEvent {
  id: string
  kind: 'http_error' | 'task_error' | 'recovery_error'
  code: string
  requestId?: string
  taskId?: string
  stage?: string
  agentId?: string
  httpStatus?: number
  durationMs?: number
  providerRequestId?: string
  createdAt: string
}
export interface OperationsOverview {
  generatedAt: string
  windowHours: number
  tasks: { status: string, count: number }[]
  usage: { calls: number, cost: string, charged: string, unresolved: number }
  resources: { files: number, bytes: string }
  errors: number
  recoveryBacklog: number
  expiredPayments: number
}
export interface OperationsTaskDetail {
  id: string
  userId: string
  conversationId: string
  requestId: string
  status: string
  agentId: string
  reason?: string
  recoveryAttempts: number
  automaticRecovery: boolean
  createdAt: string
  updatedAt: string
  tools: {
    callId: string
    name: string
    agentId: string
    effect: string
    status: string
    updatedAt: string
  }[]
  usage: {
    id: string
    modelId: string
    purpose: string
    status: string
    cost: string
    charged: string
    inputTokens: number | null
    outputTokens: number | null
    durationMs: number | null
    createdAt: string
  }[]
}
