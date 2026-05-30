// packages/coding-agent/src/types.ts

/** Input payload for a task this agent is willing to claim. */
export interface CodeTaskPayload {
  /** Short, natural-language description of what to build/fix/refactor. */
  request: string
  /**
   * Optional language hint. The model can usually infer; this is a
   * hint, not a constraint.
   */
  language?: string
  /**
   * Optional surrounding context — file contents, schemas, error
   * messages. The worker formats this into the system + user prompt.
   */
  context?: {
    files?: Array<{ path: string; content: string }>
    notes?: string[]
  }
  /** Model name to invoke. Overrides the agent's default. */
  model?: string
}

export interface CodeTaskResult {
  /** Generated code or diff. */
  output: string
  /** The model that produced it. */
  modelUsed: string
  /** Why generation terminated. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error'
  /** Tokens used (if reported by the server). */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Task kind this agent registers and claims. Uses underscore (not
 * hyphen) so it matches the kinds-registry naming convention
 * /^[a-z][a-z0-9_]*$/. Exported as a constant so external code
 * (mission control, etc.) can filter / submit matching tasks without
 * hardcoding the string.
 */
export const CODE_TASK_KIND = 'code_task' as const
export type CodeTaskKind = typeof CODE_TASK_KIND
