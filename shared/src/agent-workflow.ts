/** Versioned host prompts, never application business rules. */
export interface AgentWorkflowPrompts {
  analysis: string
  execution: string
  review: string
  answer: string
}
export interface AgentWorkflowConfiguration {
  revision: number
  prompts: AgentWorkflowPrompts
  updatedAt: string
}
export type ModelCallPurpose =
  'response' | 'compaction' | 'analysis' | 'review' | 'answer'
