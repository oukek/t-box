import type { ConfigurationSnapshot } from '@t-box/shared'
import type { EntityManager } from 'typeorm'
import { ApiError } from '@t-box/server-foundation/errors'
import { settingNumber } from '../configuration/defaults.js'
import { money } from './money.js'

/** Provider cost, independent of wallet deductions. Unknown usage remains conservatively reserved. */
export async function admitCost(
  db: EntityManager,
  input: { userId: string, taskId?: string, reserve: bigint },
  configuration?: ConfigurationSnapshot,
) {
  if (input.reserve < 0n) {
    throw new ApiError(400, 'INVALID_COST_RESERVATION', '成本预估无效')
  }
  // This short transaction lock serializes concurrent admissions across API/worker
  // processes, including different users. No network request runs while holding it.
  await db.query('SELECT id FROM ai_cost_guard WHERE id=1 FOR UPDATE')
  const [totals] = await db.query(
    `SELECT
    COALESCE(SUM(IF(created_at>=TIMESTAMP(DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR))-INTERVAL 8 HOUR,IF(status='settled',fee_micro,GREATEST(cost_reserved_micro,fee_micro)),0)),0) AS platform_cost,
    COALESCE(SUM(IF(user_id=? AND created_at>=TIMESTAMP(DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR))-INTERVAL 8 HOUR,IF(status='settled',fee_micro,GREATEST(cost_reserved_micro,fee_micro)),0)),0) AS user_cost,
    COALESCE(SUM(IF(task_id=?,IF(status='settled',fee_micro,GREATEST(cost_reserved_micro,fee_micro)),0)),0) AS task_cost
    FROM billing_usage WHERE created_at>=TIMESTAMP(DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR))-INTERVAL 8 HOUR OR task_id=?`,
    [input.userId, input.taskId || null, input.taskId || null],
  )
  const policies: [string, string, string, number][] = [
    [
      'ai.cost.platformDailyYuan',
      'platform_cost',
      '平台今日 AI 成本预算已用完',
      1000,
    ],
    ['ai.cost.userDailyYuan', 'user_cost', '今日 AI 使用预算已用完', 100],
  ]
  if (input.taskId) {
    policies.push([
      'ai.cost.taskYuan',
      'task_cost',
      '此任务的 AI 成本预算已用完',
      20,
    ])
  }
  for (const [key, field, message, fallback] of policies) {
    const limit = money(
      String(settingNumber(configuration, key, Number(fallback))),
    )
    if (limit > 0n && BigInt(totals[field] || 0) + input.reserve > limit) {
      throw new ApiError(429, 'AI_COST_LIMIT', `${message}；已完成的操作仍保留`)
    }
  }
}
