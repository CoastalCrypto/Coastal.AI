// packages/core/src/agents/run-team-chain.ts
import type { ModelRouter } from '../models/router.js'
import type { AgentRegistry } from './registry.js'
import type { NoteStore } from '../memory/notes.js'
import type { TeamChannel } from './team-channel.js'
import type { DomainClassifier } from '../routing/domain-classifier.js'
import { AgentSession, type ChatMessage } from './session.js'
import { recallContextMessage } from '../memory/recall.js'
import { canHandoff, availableHandoffTargets, type RunContext, type TurnRecord } from './run-context.js'
import { buildHandoffToolSchema, parseHandoffCall } from './handoff-tool.js'
import { writeAgentNote } from './team-notes.js'
import { verifyCommitment } from './verify-commitment.js'

const DEFAULT_TURN_BUDGET = 6
const DEFAULT_CHAIN_TIMEOUT_MS = 90_000

export interface RunTeamChainDeps {
  router: Pick<ModelRouter, 'chatWithTools' | 'chat'>
  registry: Pick<AgentRegistry, 'get' | 'list'>
  noteStore: NoteStore
  channel: TeamChannel
  classifier: Pick<DomainClassifier, 'classify'>
  defaultModel: string
  /** Cheap model tier for the verification judge (verifyCommitment) — never the large default model. */
  judgeModel: string
  /** Max handoffs+retries allowed per chain. Defaults to DEFAULT_TURN_BUDGET if not provided. */
  turnBudget?: number
  /** Wall-clock circuit breaker for the whole chain. Defaults to DEFAULT_CHAIN_TIMEOUT_MS if not provided. */
  chainTimeoutMs?: number
}

/**
 * Entry point: classify → run the chain → return the full trace. Wrapped in a
 * wall-clock timeout as a last-resort circuit breaker on top of the
 * visited-set + turnBudget guards inside runTurn. Note this does not cancel
 * an in-flight LLM call (chatWithTools has no AbortSignal support today) — it
 * only stops the caller from waiting past 90s; a synthetic trace entry
 * records that it happened.
 */
export async function runTeamChain(deps: RunTeamChainDeps, task: string): Promise<TurnRecord[]> {
  const classification = await deps.classifier.classify(task)
  const startAgent = deps.registry.get(classification.domain) ?? deps.registry.get('general')
  if (!startAgent) throw new Error('runTeamChain: no "general" fallback agent registered')

  const turnBudget = deps.turnBudget ?? DEFAULT_TURN_BUDGET
  const chainTimeoutMs = deps.chainTimeoutMs ?? DEFAULT_CHAIN_TIMEOUT_MS
  const ctx: RunContext = { visited: new Set(), turnBudget, trace: [] }

  let timedOut = false
  const timeout = new Promise<void>(resolve => {
    setTimeout(() => { timedOut = true; resolve() }, chainTimeoutMs)
  })
  await Promise.race([runTurn(deps, startAgent.id, task, ctx, null), timeout])

  if (timedOut) {
    ctx.trace.push({
      agentId: 'system',
      agentName: 'System',
      reply: 'Chain timed out after 90s — stopping here.',
      unresolved: true,
      verificationNote: 'timeout',
    })
  }
  return ctx.trace
}

async function runTurn(
  deps: RunTeamChainDeps,
  agentId: string,
  task: string,
  ctx: RunContext,
  incomingExpectation: string | null,
): Promise<void> {
  const agent = deps.registry.get(agentId)
  if (!agent) throw new Error(`runTeamChain: unknown agent "${agentId}"`)

  const activeIds = new Set(deps.registry.list().map(a => a.id))
  const targets = availableHandoffTargets(ctx, agentId, activeIds)
  const session = new AgentSession(agent, [])
  const recall = recallContextMessage(deps.noteStore, task)
  const userContent = incomingExpectation
    ? `${task}\n\n[You were handed this task. What's specifically expected of you: ${incomingExpectation}]`
    : task

  const messages: ChatMessage[] = [
    { role: 'system', content: session.systemPrompt },
    ...(recall ? [recall] : []),
    ...traceAsMessages(ctx.trace),
    { role: 'user', content: userContent },
  ]

  const tools = targets.length > 0 ? [buildHandoffToolSchema(targets)] : []
  const model = agent.modelPref ?? deps.defaultModel

  let content: string
  let toolCalls: Awaited<ReturnType<ModelRouter['chatWithTools']>>['toolCalls']
  try {
    ;({ content, toolCalls } = await deps.router.chatWithTools(model, messages, tools))
  } catch (err) {
    pushAgentCallFailure(ctx, err)
    return
  }
  let handoff = parseHandoffCall(toolCalls)

  // A handoff call naming a target canHandoff rejects (self, already visited,
  // inactive, or budget exhausted) can still reach us if a model ignores the
  // schema's enum restriction. In that case `content` is whatever text rode
  // alongside the (invalid) tool call, not a real answer — force one retry
  // with the handoff tool withheld so the agent gives a genuine direct reply
  // instead of silently accepting that leftover text as the turn's output.
  if (handoff && !canHandoff(ctx, handoff.targetAgentId, agentId, activeIds)) {
    try {
      ;({ content, toolCalls } = await deps.router.chatWithTools(model, messages, []))
    } catch (err) {
      pushAgentCallFailure(ctx, err)
      return
    }
    handoff = null
  }

  writeAgentNote(deps.noteStore, agentId, agent.name, content || `(handed off to ${handoff?.targetAgentId ?? 'unknown'})`)

  if (handoff && canHandoff(ctx, handoff.targetAgentId, agentId, activeIds)) {
    ctx.visited.add(agentId)
    ctx.turnBudget -= 1
    deps.channel.post(agentId, handoff.targetAgentId, { type: 'task', payload: handoff.expectation })
    ctx.trace.push({
      agentId, agentName: agent.name, reply: content,
      handoffTo: handoff.targetAgentId, expectation: handoff.expectation,
    })

    // Capture the index of the turn about to be created for the handoff
    // target BEFORE recursing — if that recursive call itself hands off
    // further (B→C, C→D, ...), ctx.trace.length keeps growing past this
    // point, so "last element" is no longer a safe way to find "the turn
    // this direct peer produced." targetIndex pins it precisely.
    const targetIndex = ctx.trace.length
    await runTurn(deps, handoff.targetAgentId, task, ctx, handoff.expectation)
    // If the recursive call short-circuited into a synthetic system failure
    // entry (see pushAgentCallFailure), there is no real reply to verify —
    // running it through the judge would just clobber the failure note with
    // an unrelated "verification unavailable" from an unmocked/empty judge
    // call. Leave it as-is; it's already flagged unresolved.
    if (ctx.trace[targetIndex]?.agentId !== 'system') {
      await verifyLastTurn(deps, ctx, targetIndex, handoff.expectation, task)
    }
  } else {
    ctx.trace.push({ agentId, agentName: agent.name, reply: content })
  }
}

/** Appends a synthetic system trace entry when an agent call fails outright, mirroring the timeout path's shape. Callers must return immediately after — no further handoffs are attempted for this turn. */
function pushAgentCallFailure(ctx: RunContext, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  ctx.trace.push({
    agentId: 'system',
    agentName: 'System',
    reply: `Agent call failed: ${message}`,
    unresolved: true,
    verificationNote: 'agent call failed',
  })
}

/**
 * Checks the trace entry at `targetIndex` — the direct peer's own turn,
 * pinned by the caller before it recursed any deeper — against the
 * expectation. Unsatisfied + budget remaining → exactly one retry, same
 * agent, expectation restated, handoff tool withheld (forces a direct,
 * resolving reply rather than another handoff). Still unsatisfied, or no
 * budget left for a retry → the turn stays flagged unresolved.
 *
 * targetIndex must NOT be re-derived as "last element of ctx.trace" here:
 * by the time a chain 3+ hops deep unwinds, later (nested) verification
 * calls and their retries may have pushed additional entries, so "last"
 * would silently point at some other agent's turn instead of this one.
 */
async function verifyLastTurn(
  deps: RunTeamChainDeps,
  ctx: RunContext,
  targetIndex: number,
  expectation: string,
  task: string,
): Promise<void> {
  const targetTurn = ctx.trace[targetIndex]
  const verdict = await verifyCommitment(deps.router, deps.judgeModel, expectation, targetTurn.reply)
  targetTurn.unresolved = !verdict.satisfied
  targetTurn.verificationNote = verdict.note

  if (verdict.satisfied || ctx.turnBudget <= 0) return

  ctx.turnBudget -= 1
  const retryAgentId = targetTurn.agentId
  const agent = deps.registry.get(retryAgentId)
  if (!agent) return

  const session = new AgentSession(agent, [])
  const recall = recallContextMessage(deps.noteStore, task)
  const messages: ChatMessage[] = [
    { role: 'system', content: session.systemPrompt },
    ...(recall ? [recall] : []),
    ...traceAsMessages(ctx.trace),
    { role: 'user', content: `${expectation}\n\nYour previous reply didn't address this (${verdict.note}). Please respond directly.` },
  ]
  const model = agent.modelPref ?? deps.defaultModel

  let retryContent: string
  try {
    ;({ content: retryContent } = await deps.router.chatWithTools(model, messages, []))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    targetTurn.unresolved = true
    targetTurn.verificationNote = `retry failed: ${message}`
    return
  }
  writeAgentNote(deps.noteStore, retryAgentId, agent.name, retryContent)

  const retryVerdict = await verifyCommitment(deps.router, deps.judgeModel, expectation, retryContent)
  ctx.trace.push({
    agentId: retryAgentId,
    agentName: agent.name,
    reply: retryContent,
    unresolved: !retryVerdict.satisfied,
    verificationNote: retryVerdict.note,
  })
}

/** Prior turns rendered as assistant messages so the next agent sees the conversation so far. */
function traceAsMessages(trace: TurnRecord[]): ChatMessage[] {
  return trace.map(t => ({ role: 'assistant' as const, content: `[${t.agentName}]: ${t.reply}` }))
}
