import type { ConfigurationSnapshot } from '@t-box/shared'
import type { EntityManager } from 'typeorm'
import { settingNumber } from '../configuration/defaults.js'
import { AiCostGuardEntity } from '../db/records/models-entities.js'
import { ErrorCode } from '../error-codes.js'
import { money } from './money.js'

/** Provider cost, independent of wallet deductions. Unknown usage remains conservatively reserved. */
export async function admitCost(
  db: EntityManager,
  input: { userId: string, taskId?: string, reserve: bigint },
  configuration?: ConfigurationSnapshot,
) {
  if (input.reserve < 0n) {
    throw ErrorCode.INVALID_COST_RESERVATION()
  }
  // This short transaction lock serializes concurrent admissions across API/worker
  // processes, including different users. No network request runs while holding it.
  await db.getRepository(AiCostGuardEntity).find({
    select: { id: true },
    where: { id: 1 },
    lock: { mode: 'pessimistic_write' },
  })
  const [totals] = await db
    .createQueryBuilder()
    .select(
      'COALESCE(SUM(IF(created_at>=TIMESTAMP(DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR))-INTERVAL 8 HOUR,IF(status=\'settled\',fee_micro,GREATEST(cost_reserved_micro,fee_micro)),0)),0) AS platform_cost,\n    COALESCE(SUM(IF(user_id=:p0 AND created_at>=TIMESTAMP(DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR))-INTERVAL 8 HOUR,IF(status=\'settled\',fee_micro,GREATEST(cost_reserved_micro,fee_micro)),0)),0) AS user_cost,\n    COALESCE(SUM(IF(task_id=:p1,IF(status=\'settled\',fee_micro,GREATEST(cost_reserved_micro,fee_micro)),0)),0) AS task_cost',
    )
    .from('billing_usage', 'billing_usage')
    .where(
      'created_at>=TIMESTAMP(DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR))-INTERVAL 8 HOUR OR task_id=:p2',
    )
    .setParameters({
      p0: input.userId,
      p1: input.taskId || null,
      p2: input.taskId || null,
    })
    .getRawMany()
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
      throw ErrorCode.AI_COST_LIMIT(`${message}；已完成的操作仍保留`)
    }
  }
}
