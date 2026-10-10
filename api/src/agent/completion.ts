import type { ToolCallView, ToolResult } from '@t-box/shared'
import type { ToolRegistration } from './contracts.js'
import type { WorkflowPlan } from './workflow.js'

/**
 * The model selects a single-operation route; the trusted application validates
 * its result. No app names, resource formats or business rules belong here.
 */
export function receiptCompletion(
  plan: WorkflowPlan | undefined,
  receipts: ToolCallView[],
  results: ReadonlyMap<string, { result?: ToolResult }>,
  tools: Readonly<Record<string, ToolRegistration>>,
): string | undefined {
  if (
    plan?.route !== 'execute' ||
    plan.verification !== 'receipt' ||
    plan.steps.length !== 1 ||
    plan.requiredTools.length !== 1 ||
    receipts.some(
      (r) => r.status !== 'completed' || !results.get(r.id)?.result?.ok,
    )
  ) {
    return
  }
  const operations = receipts.filter(
    (r) => tools[r.name]?.effect !== 'configuration',
  )
  if (operations.length !== 1 || operations[0]!.name !== plan.requiredTools[0]) {
    return
  }
  const operation = operations[0]!
  const result = results.get(operation.id)?.result
  const tool = tools[operation.name]
  if (!result?.ok || !tool?.completionSummary) {
    return
  }
  let summary: string | undefined
  try {
    summary = tool.completionSummary(result)
  } catch {
    // An application verifier failure must fall back to the full workflow.
    return
  }
  if (typeof summary === 'string' && summary.trim() && summary.length <= 1000) {
    return summary
  }
}
