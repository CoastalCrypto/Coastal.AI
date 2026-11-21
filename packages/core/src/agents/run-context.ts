export interface TurnRecord {
  agentId: string
  agentName: string
  reply: string
  /** Set only when this turn ended in a handoff. */
  handoffTo?: string
  /** The structured commitment the handoff target is expected to satisfy. */
  expectation?: string
  /** Set by verifyCommitment after a handoff target's reply (or its retry). */
  unresolved?: boolean
  verificationNote?: string
}

export interface RunContext {
  /** Agents that have already taken a turn on this task — cannot be handed the task again. */
  visited: Set<string>
  /** Remaining handoffs allowed. Decrements once per handoff (and once more per retry). */
  turnBudget: number
  trace: TurnRecord[]
}

/**
 * Guards, in order: no self-handoff, budget must remain, target must not have
 * already taken a turn on this task, target must be a currently-active agent.
 */
export function canHandoff(
  ctx: RunContext,
  targetId: string,
  selfId: string,
  activeAgentIds: ReadonlySet<string>,
): boolean {
  if (targetId === selfId) return false
  if (ctx.turnBudget <= 0) return false
  if (ctx.visited.has(targetId)) return false
  if (!activeAgentIds.has(targetId)) return false
  return true
}

/** The set of ids a handoff tool schema should offer as valid targets this turn. */
export function availableHandoffTargets(
  ctx: RunContext,
  selfId: string,
  activeAgentIds: ReadonlySet<string>,
): string[] {
  return [...activeAgentIds].filter(id => canHandoff(ctx, id, selfId, activeAgentIds))
}
