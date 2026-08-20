# Decentralized Team Agents (Desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `BossAgent`'s decompose/fan-out/synthesize head-orchestrator and replace it with a classify-to-one + multi-hop peer-handoff chain over a shared `NoteStore`, with a commitment-verification check on every handoff.

**Architecture:** `DomainClassifier` (unchanged) picks the first soul agent. Each turn recalls shared memory, may call a `handoff` tool naming a peer + a structured `expectation`, and writes its reply back to the shared store. After a handoff, a cheap LLM judge checks whether the peer's reply satisfied the `expectation`; one retry on failure, then a visible `unresolved` flag. The whole chain is capped by a `visited`-set cycle guard, a `turnBudget`, and a 90s wall-clock backstop.

**Tech Stack:** TypeScript, Fastify (route), better-sqlite3 (`NoteStore`), Vitest (`pool: 'forks'`), existing `ModelRouter.chatWithTools` tool-calling infra, React (web UI).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-20-decentralized-team-agents-design.md` (as amended in commit `b73bc03`) — every task below implements a row from its "Locked decisions" table.
- No fixed hop cap; cycle guard is the `visited` set, cost guard is `turnBudget` (default 6), backstop is a 90s wall-clock timeout.
- `handoff` takes a structured `expectation` string, never a freeform "reason" — this is the direct fix for CooperBench's "messaging alone doesn't help" finding.
- Verification failures fail **open toward visibility** (`unresolved: true`), never silently — this differs from `recall.ts`'s existing fail-*silent* pattern, and each task below calls out which one applies.
- `BossAgent` is deleted outright, no legacy/fallback path.
- Follow existing repo conventions: ESM (`.js` extensions on relative imports even though files are `.ts`), `vi.fn()`-style mocks matching `boss-agent.test.ts`, `pool: 'forks'` already configured for `packages/core` (no action needed, just don't fight it).

---

## File Structure

```
packages/core/src/agents/
  run-context.ts              NEW  — TurnRecord, RunContext, canHandoff, availableHandoffTargets (pure)
  verify-commitment.ts        NEW  — verifyCommitment (LLM judge)
  handoff-tool.ts              NEW  — buildHandoffToolSchema, parseHandoffCall
  team-notes.ts                NEW  — registers 'agent_note' kind, writeAgentNote helper
  run-team-chain.ts            NEW  — the orchestrator (runTeamChain, runTurn, verifyLastTurn)
  boss-agent.ts                 DELETE
  __tests__/boss-agent.test.ts  DELETE
  __tests__/run-context.test.ts        NEW
  __tests__/verify-commitment.test.ts  NEW
  __tests__/handoff-tool.test.ts       NEW
  __tests__/team-notes.test.ts         NEW
  __tests__/run-team-chain.test.ts     NEW
packages/core/src/api/routes/team.ts   MODIFY — thin wiring, delegates to runTeamChain
packages/web/src/api/client.ts         MODIFY — TeamTurn type + runTeam() return shape
packages/web/src/pages/chat/types.ts   MODIFY — Message.trace replaces subtasks/subtaskCount
packages/web/src/pages/chat/TeamResult.tsx  MODIFY — renders trace as a relay
packages/web/src/pages/Chat.tsx        MODIFY — send()'s teamMode branch consumes {trace}
packages/web/src/components/ChatPane.test.tsx  MODIFY — mock shape update
```

---

### Task 1: `run-context.ts` — pure chain-state types and guards

**Files:**
- Create: `packages/core/src/agents/run-context.ts`
- Test: `packages/core/src/agents/__tests__/run-context.test.ts`

**Interfaces:**
- Produces: `TurnRecord`, `RunContext`, `canHandoff(ctx, targetId, selfId, activeAgentIds): boolean`, `availableHandoffTargets(ctx, selfId, activeAgentIds): string[]` — used by every later task in this plan.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/agents/__tests__/run-context.test.ts
import { describe, it, expect } from 'vitest'
import { canHandoff, availableHandoffTargets, type RunContext } from '../run-context.js'

function freshCtx(overrides: Partial<RunContext> = {}): RunContext {
  return { visited: new Set(), turnBudget: 6, trace: [], ...overrides }
}

describe('canHandoff', () => {
  it('allows a valid, unvisited, active target', () => {
    const ctx = freshCtx()
    expect(canHandoff(ctx, 'cfo', 'cto', new Set(['cto', 'cfo']))).toBe(true)
  })

  it('rejects handoff to self', () => {
    const ctx = freshCtx()
    expect(canHandoff(ctx, 'cto', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })

  it('rejects a target that is already visited', () => {
    const ctx = freshCtx({ visited: new Set(['cfo']) })
    expect(canHandoff(ctx, 'cfo', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })

  it('rejects when turnBudget is exhausted', () => {
    const ctx = freshCtx({ turnBudget: 0 })
    expect(canHandoff(ctx, 'cfo', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })

  it('rejects a target that is not in the active agent set', () => {
    const ctx = freshCtx()
    expect(canHandoff(ctx, 'ghost', 'cto', new Set(['cto', 'cfo']))).toBe(false)
  })
})

describe('availableHandoffTargets', () => {
  it('excludes self and visited, includes everyone else active', () => {
    const ctx = freshCtx({ visited: new Set(['coo']) })
    const targets = availableHandoffTargets(ctx, 'cto', new Set(['cto', 'cfo', 'coo', 'general']))
    expect(targets.sort()).toEqual(['cfo', 'general'])
  })

  it('returns empty when turnBudget is 0', () => {
    const ctx = freshCtx({ turnBudget: 0 })
    const targets = availableHandoffTargets(ctx, 'cto', new Set(['cto', 'cfo']))
    expect(targets).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/__tests__/run-context.test.ts`
Expected: FAIL — `Cannot find module '../run-context.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/agents/run-context.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/__tests__/run-context.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/run-context.ts packages/core/src/agents/__tests__/run-context.test.ts
git commit -m "feat(core): add RunContext + canHandoff/availableHandoffTargets guards"
```

---

### Task 2: `verify-commitment.ts` — the LLM judge

**Files:**
- Create: `packages/core/src/agents/verify-commitment.ts`
- Test: `packages/core/src/agents/__tests__/verify-commitment.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CommitmentVerdict`, `verifyCommitment(router, model, expectation, reply): Promise<CommitmentVerdict>` — used by `run-team-chain.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/agents/__tests__/verify-commitment.test.ts
import { describe, it, expect, vi } from 'vitest'
import { verifyCommitment } from '../verify-commitment.js'

describe('verifyCommitment', () => {
  it('returns satisfied: true when the judge says so', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: '{"satisfied": true, "note": "gave a number"}', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'give a cost estimate', 'it is $5k')
    expect(verdict).toEqual({ satisfied: true, note: 'gave a number' })
  })

  it('returns satisfied: false when the judge says so', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: '{"satisfied": false, "note": "no number given"}', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'give a cost estimate', 'not sure')
    expect(verdict).toEqual({ satisfied: false, note: 'no number given' })
  })

  it('fails open toward unresolved when the judge returns malformed JSON', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: 'not json', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'x', 'y')
    expect(verdict).toEqual({ satisfied: false, note: 'verification unavailable' })
  })

  it('fails open toward unresolved when satisfied is missing or non-boolean', async () => {
    const router = { chat: vi.fn().mockResolvedValue({ reply: '{"note": "hmm"}', decision: {} }) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'x', 'y')
    expect(verdict).toEqual({ satisfied: false, note: 'verification unavailable' })
  })

  it('fails open toward unresolved when the router call throws', async () => {
    const router = { chat: vi.fn().mockRejectedValue(new Error('model unavailable')) }
    const verdict = await verifyCommitment(router as any, 'qwen2.5:0.5b', 'x', 'y')
    expect(verdict).toEqual({ satisfied: false, note: 'verification unavailable' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/__tests__/verify-commitment.test.ts`
Expected: FAIL — `Cannot find module '../verify-commitment.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/agents/verify-commitment.ts
import type { ModelRouter } from '../models/router.js'

export interface CommitmentVerdict {
  satisfied: boolean
  note: string
}

const VERIFY_PROMPT = (expectation: string, reply: string) => `
You are checking whether a teammate's reply addresses what was specifically asked of them.

Expectation: ${expectation}

Reply: ${reply}

Respond ONLY with valid JSON in this exact format: {"satisfied": true, "note": "one short sentence why"}
No other text.
`.trim()

/**
 * Cheap LLM-as-judge check. Fails open toward `satisfied: false` — an
 * unreadable verdict must surface as unresolved, never be treated as quietly
 * satisfied. This is the direct fix for CooperBench's finding that agent
 * messages went unverified and got silently dropped.
 */
export async function verifyCommitment(
  router: Pick<ModelRouter, 'chat'>,
  model: string,
  expectation: string,
  reply: string,
): Promise<CommitmentVerdict> {
  try {
    const { reply: raw } = await router.chat(
      [{ role: 'user', content: VERIFY_PROMPT(expectation, reply) }],
      { model },
    )
    const parsed = JSON.parse(raw.trim()) as { satisfied?: unknown; note?: unknown }
    if (typeof parsed.satisfied !== 'boolean') {
      return { satisfied: false, note: 'verification unavailable' }
    }
    return { satisfied: parsed.satisfied, note: typeof parsed.note === 'string' ? parsed.note : '' }
  } catch {
    return { satisfied: false, note: 'verification unavailable' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/__tests__/verify-commitment.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/verify-commitment.ts packages/core/src/agents/__tests__/verify-commitment.test.ts
git commit -m "feat(core): add verifyCommitment LLM judge for handoff commitments"
```

---

### Task 3: `handoff-tool.ts` — the tool schema and call parser

**Files:**
- Create: `packages/core/src/agents/handoff-tool.ts`
- Test: `packages/core/src/agents/__tests__/handoff-tool.test.ts`

**Interfaces:**
- Consumes: `OllamaToolSchema` (from `./session.js`), `ToolCall` (from `./types.js`) — both pre-existing.
- Produces: `HANDOFF_TOOL_NAME`, `HandoffCall`, `buildHandoffToolSchema(targets): OllamaToolSchema`, `parseHandoffCall(toolCalls): HandoffCall | null` — used by `run-team-chain.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/agents/__tests__/handoff-tool.test.ts
import { describe, it, expect } from 'vitest'
import { HANDOFF_TOOL_NAME, buildHandoffToolSchema, parseHandoffCall } from '../handoff-tool.js'

describe('buildHandoffToolSchema', () => {
  it('builds a function schema whose targetAgentId enum matches the given targets', () => {
    const schema = buildHandoffToolSchema(['cfo', 'coo'])
    expect(schema.type).toBe('function')
    expect(schema.function.name).toBe(HANDOFF_TOOL_NAME)
    expect(schema.function.parameters.properties.targetAgentId.enum).toEqual(['cfo', 'coo'])
    expect(schema.function.parameters.required).toEqual(['targetAgentId', 'expectation'])
  })
})

describe('parseHandoffCall', () => {
  it('extracts targetAgentId and expectation from a matching tool call', () => {
    const call = parseHandoffCall([
      { id: '1', name: HANDOFF_TOOL_NAME, args: { targetAgentId: 'cfo', expectation: 'give a cost estimate' } },
    ])
    expect(call).toEqual({ targetAgentId: 'cfo', expectation: 'give a cost estimate' })
  })

  it('returns null when there is no handoff call', () => {
    expect(parseHandoffCall([{ id: '1', name: 'some_other_tool', args: {} }])).toBeNull()
    expect(parseHandoffCall([])).toBeNull()
  })

  it('returns null when the handoff call has missing or wrongly-typed args', () => {
    expect(parseHandoffCall([{ id: '1', name: HANDOFF_TOOL_NAME, args: { targetAgentId: 'cfo' } }])).toBeNull()
    expect(parseHandoffCall([{ id: '1', name: HANDOFF_TOOL_NAME, args: { targetAgentId: 5, expectation: 'x' } }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/__tests__/handoff-tool.test.ts`
Expected: FAIL — `Cannot find module '../handoff-tool.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/agents/handoff-tool.ts
import type { OllamaToolSchema } from './session.js'
import type { ToolCall } from './types.js'

export const HANDOFF_TOOL_NAME = 'handoff'

export interface HandoffCall {
  targetAgentId: string
  expectation: string
}

/**
 * targetAgentId is constrained to an enum built fresh each turn from
 * availableHandoffTargets — this makes an invalid-target handoff call
 * structurally impossible for the model to produce, not just rejected after
 * the fact.
 */
export function buildHandoffToolSchema(targets: string[]): OllamaToolSchema {
  return {
    type: 'function',
    function: {
      name: HANDOFF_TOOL_NAME,
      description:
        'Hand this task off to a specific teammate who genuinely needs to handle part of it. ' +
        'Only call this if you actually need another domain\'s expertise — otherwise just answer directly.',
      parameters: {
        type: 'object',
        properties: {
          targetAgentId: { type: 'string', description: 'The teammate to hand off to.', enum: targets },
          expectation: {
            type: 'string',
            description: 'A specific, checkable statement of what you need them to deliver — not a vague reason.',
          },
        },
        required: ['targetAgentId', 'expectation'],
      },
    },
  }
}

export function parseHandoffCall(toolCalls: ToolCall[]): HandoffCall | null {
  const call = toolCalls.find(tc => tc.name === HANDOFF_TOOL_NAME)
  if (!call) return null
  const { targetAgentId, expectation } = call.args
  if (typeof targetAgentId !== 'string' || typeof expectation !== 'string') return null
  return { targetAgentId, expectation }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/__tests__/handoff-tool.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/handoff-tool.ts packages/core/src/agents/__tests__/handoff-tool.test.ts
git commit -m "feat(core): add handoff tool schema builder and call parser"
```

---

### Task 4: `team-notes.ts` — register the note kind and the write helper

**Files:**
- Create: `packages/core/src/agents/team-notes.ts`
- Test: `packages/core/src/agents/__tests__/team-notes.test.ts`

**Interfaces:**
- Consumes: `NoteStore` (from `../memory/notes.js`), `registerKind`/`isRegisteredKind` (from `../memory/kinds-registry.js`) — both pre-existing.
- Produces: `writeAgentNote(noteStore, agentId, agentName, body): void` — used by `run-team-chain.ts` (Task 5). Importing this module registers the `'agent_note'` kind as a side effect.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/agents/__tests__/team-notes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../../memory/notes.js'
import { isRegisteredKind } from '../../memory/kinds-registry.js'
import { writeAgentNote } from '../team-notes.js'

describe('team-notes', () => {
  it('registers the agent_note kind on import', () => {
    expect(isRegisteredKind('agent_note')).toBe(true)
  })

  it('writes a note attributed to the agent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coastal-team-notes-'))
    const store = new NoteStore({ dataDir: dir })
    writeAgentNote(store, 'cto', 'Chief Technology Officer', 'we should use postgres')

    const [note] = store.list({ kind: 'agent_note' })
    expect(note.kind).toBe('agent_note')
    expect(note.sourceType).toBe('agent')
    expect(note.sourceId).toBe('cto')
    expect(note.body).toBe('we should use postgres')

    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('swallows a NoteStore failure instead of throwing', () => {
    const failingStore = { create: vi.fn(() => { throw new Error('disk full') }) }
    expect(() => writeAgentNote(failingStore as any, 'cto', 'CTO', 'x')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/__tests__/team-notes.test.ts`
Expected: FAIL — `Cannot find module '../team-notes.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/agents/team-notes.ts
import { registerKind } from '../memory/kinds-registry.js'
import type { NoteStore } from '../memory/notes.js'

// Module-load-time registration, same convention as every other kind-registering
// package (see kinds-registry.ts's own doc comment).
registerKind('agent_note')

/**
 * Write an agent's turn into the shared store so any later, unrelated task can
 * recall it via recallContextMessage. Fail-open and silent on error — a
 * memory-write failure must never fail the user-facing reply (unlike
 * verifyCommitment, which fails open toward *visibility* — these are
 * different failure classes on purpose).
 */
export function writeAgentNote(noteStore: NoteStore, agentId: string, agentName: string, body: string): void {
  try {
    noteStore.create({
      title: `${agentName} — team note`,
      body,
      kind: 'agent_note',
      sourceType: 'agent',
      sourceId: agentId,
    })
  } catch (err) {
    console.error(`[team-notes] failed to write note for agent ${agentId}:`, err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/__tests__/team-notes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/team-notes.ts packages/core/src/agents/__tests__/team-notes.test.ts
git commit -m "feat(core): register agent_note kind and add writeAgentNote helper"
```

---

### Task 5: `run-team-chain.ts` — the orchestrator

This is the task that ties Tasks 1–4 together plus the pre-existing `AgentSession`, `recallContextMessage`, `AgentRegistry`, `TeamChannel`, `DomainClassifier`, and `ModelRouter.chatWithTools`.

**Files:**
- Create: `packages/core/src/agents/run-team-chain.ts`
- Test: `packages/core/src/agents/__tests__/run-team-chain.test.ts`

**Interfaces:**
- Consumes:
  - `TurnRecord`, `RunContext`, `canHandoff`, `availableHandoffTargets` (Task 1)
  - `verifyCommitment` (Task 2)
  - `buildHandoffToolSchema`, `parseHandoffCall` (Task 3)
  - `writeAgentNote` (Task 4)
  - `AgentSession`, `ChatMessage` (pre-existing, `./session.js`)
  - `recallContextMessage` (pre-existing, `../memory/recall.js`)
  - `AgentRegistry` (pre-existing, `./registry.js`)
  - `NoteStore` (pre-existing, `../memory/notes.js`)
  - `TeamChannel` (pre-existing, `./team-channel.js`)
  - `DomainClassifier` (pre-existing, `../routing/domain-classifier.js`)
  - `ModelRouter` (pre-existing, `../models/router.js`)
- Produces: `RunTeamChainDeps`, `runTeamChain(deps, task): Promise<TurnRecord[]>` — used by `team.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/agents/__tests__/run-team-chain.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runTeamChain, type RunTeamChainDeps } from '../run-team-chain.js'
import { TeamChannel } from '../team-channel.js'
import { NoteStore } from '../../memory/notes.js'
import type { AgentConfig } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function makeAgent(id: string, name: string): AgentConfig {
  return {
    id, name, role: '', tools: [], builtIn: true, active: true, createdAt: 0,
    // Real soul files ship in packages/core/src/agents/souls/ — reuse them so
    // AgentSession.systemPrompt can actually read a file instead of needing a
    // filesystem mock.
    soulPath: join(__dirname, '..', 'souls', `SOUL_${id.toUpperCase()}.md`),
  }
}

const FOUR_AGENTS: Record<string, AgentConfig> = {
  cto: makeAgent('cto', 'Chief Technology Officer'),
  cfo: makeAgent('cfo', 'Chief Financial Officer'),
  coo: makeAgent('coo', 'Chief Operating Officer'),
  general: makeAgent('general', 'General Assistant'),
}

function baseDeps(overrides: Partial<RunTeamChainDeps> = {}): RunTeamChainDeps {
  return {
    router: { chatWithTools: vi.fn(), chat: vi.fn() } as any,
    registry: {
      get: vi.fn((id: string) => FOUR_AGENTS[id] ?? null),
      list: vi.fn(() => Object.values(FOUR_AGENTS)),
    } as any,
    noteStore: { search: vi.fn().mockReturnValue([]), create: vi.fn() } as any,
    channel: new TeamChannel(),
    classifier: { classify: vi.fn().mockResolvedValue({ domain: 'cto', confidence: 0.9, classifiedBy: 'rules' }) } as any,
    defaultModel: 'llama3.2',
    ...overrides,
  }
}

describe('runTeamChain', () => {
  let deps: RunTeamChainDeps

  beforeEach(() => {
    deps = baseDeps()
  })

  it('single turn, no handoff', async () => {
    ;(deps.router.chatWithTools as any).mockResolvedValueOnce({ content: 'direct answer', toolCalls: [] })

    const trace = await runTeamChain(deps, 'do a thing')

    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({ agentId: 'cto', agentName: 'Chief Technology Officer', reply: 'direct answer' })
    expect(trace[0].unresolved).toBeUndefined()
    expect(deps.noteStore.create).toHaveBeenCalledTimes(1)
  })

  it('two-hop handoff with verification satisfied', async () => {
    ;(deps.router.chatWithTools as any)
      .mockResolvedValueOnce({
        content: 'I need budget input',
        toolCalls: [{ id: '1', name: 'handoff', args: { targetAgentId: 'cfo', expectation: 'Provide a cost estimate' } }],
      })
      .mockResolvedValueOnce({ content: 'Estimate is $5k', toolCalls: [] })
    ;(deps.router.chat as any).mockResolvedValueOnce({ reply: '{"satisfied": true, "note": "gave a number"}', decision: {} })

    const trace = await runTeamChain(deps, 'plan a project')

    expect(trace).toHaveLength(2)
    expect(trace[0]).toMatchObject({ agentId: 'cto', handoffTo: 'cfo', expectation: 'Provide a cost estimate' })
    expect(trace[1]).toMatchObject({
      agentId: 'cfo', reply: 'Estimate is $5k', unresolved: false, verificationNote: 'gave a number',
    })
  })

  it('unsatisfied verification triggers exactly one retry, then marks unresolved', async () => {
    ;(deps.router.chatWithTools as any)
      .mockResolvedValueOnce({
        content: 'ask cfo',
        toolCalls: [{ id: '1', name: 'handoff', args: { targetAgentId: 'cfo', expectation: 'Give a number' } }],
      })
      .mockResolvedValueOnce({ content: 'I am not sure', toolCalls: [] }) // cfo, first attempt
      .mockResolvedValueOnce({ content: 'Still unsure', toolCalls: [] }) // cfo, retry
    ;(deps.router.chat as any)
      .mockResolvedValueOnce({ reply: '{"satisfied": false, "note": "no number given"}', decision: {} })
      .mockResolvedValueOnce({ reply: '{"satisfied": false, "note": "still no number"}', decision: {} })

    const trace = await runTeamChain(deps, 'plan a project')

    expect(trace).toHaveLength(3)
    expect(trace[1]).toMatchObject({ reply: 'I am not sure', unresolved: true, verificationNote: 'no number given' })
    expect(trace[2]).toMatchObject({ reply: 'Still unsure', unresolved: true, verificationNote: 'still no number' })
    expect(deps.router.chatWithTools).toHaveBeenCalledTimes(3)
    // The retry call must not offer the handoff tool — it forces a direct reply.
    expect((deps.router.chatWithTools as any).mock.calls[2][2]).toEqual([])
  })

  it('falls back to the general agent when the classifier picks an unknown domain', async () => {
    ;(deps.classifier.classify as any).mockResolvedValue({ domain: 'nonexistent', confidence: 0, classifiedBy: 'rules' })
    ;(deps.router.chatWithTools as any).mockResolvedValueOnce({ content: 'ok', toolCalls: [] })

    const trace = await runTeamChain(deps, 'anything')

    expect(trace[0].agentId).toBe('general')
  })

  it('offers no handoff tool once every other active agent has been visited or is self', async () => {
    // With only 4 agents in the mock registry, the visited-set cycle guard
    // exhausts available targets well before turnBudget (6) does — this
    // proves the "no valid targets left" path forces a direct reply, whichever
    // guard causes it.
    ;(deps.router.chatWithTools as any).mockImplementation((_model: string, _messages: unknown, tools: unknown[]) => {
      if (tools.length === 0) return Promise.resolve({ content: 'final answer, no more handoff available', toolCalls: [] })
      return Promise.resolve({
        content: 'handing off',
        toolCalls: [{ id: 'x', name: 'handoff', args: { targetAgentId: 'general', expectation: 'placeholder' } }],
      })
    })
    ;(deps.router.chat as any).mockResolvedValue({ reply: '{"satisfied": true, "note": "ok"}', decision: {} })

    const trace = await runTeamChain(deps, 'anything')

    expect(trace[trace.length - 1].reply).toBe('final answer, no more handoff available')
  })

  it('a note written during one task is recallable during a later, unrelated task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coastal-team-chain-'))
    const realStore = new NoteStore({ dataDir: dir })
    const realDeps = baseDeps({ noteStore: realStore })

    ;(realDeps.router.chatWithTools as any).mockResolvedValueOnce({
      content: 'the Q3 budget is 5000 dollars', toolCalls: [],
    })
    await runTeamChain(realDeps, 'what is the Q3 budget')

    const seenMessages: any[] = []
    ;(realDeps.router.chatWithTools as any).mockImplementationOnce((_model: string, messages: any[]) => {
      seenMessages.push(...messages)
      return Promise.resolve({ content: 'ok', toolCalls: [] })
    })
    await runTeamChain(realDeps, 'remind me about the Q3 budget')

    const recalledBlock = seenMessages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Relevant memory'))
    expect(recalledBlock?.content).toContain('5000')

    realStore.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/__tests__/run-team-chain.test.ts`
Expected: FAIL — `Cannot find module '../run-team-chain.js'`

- [ ] **Step 3: Write the implementation**

```typescript
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

const CHAIN_TIMEOUT_MS = 90_000

export interface RunTeamChainDeps {
  router: Pick<ModelRouter, 'chatWithTools' | 'chat'>
  registry: Pick<AgentRegistry, 'get' | 'list'>
  noteStore: NoteStore
  channel: TeamChannel
  classifier: Pick<DomainClassifier, 'classify'>
  defaultModel: string
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

  const ctx: RunContext = { visited: new Set(), turnBudget: 6, trace: [] }

  let timedOut = false
  const timeout = new Promise<void>(resolve => {
    setTimeout(() => { timedOut = true; resolve() }, CHAIN_TIMEOUT_MS)
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
  const { content, toolCalls } = await deps.router.chatWithTools(model, messages, tools)
  const handoff = parseHandoffCall(toolCalls)

  writeAgentNote(deps.noteStore, agentId, agent.name, content || `(handed off to ${handoff?.targetAgentId ?? 'unknown'})`)

  if (handoff && canHandoff(ctx, handoff.targetAgentId, agentId, activeIds)) {
    ctx.visited.add(agentId)
    ctx.turnBudget -= 1
    deps.channel.post(agentId, handoff.targetAgentId, { type: 'task', payload: handoff.expectation })
    ctx.trace.push({
      agentId, agentName: agent.name, reply: content,
      handoffTo: handoff.targetAgentId, expectation: handoff.expectation,
    })

    await runTurn(deps, handoff.targetAgentId, task, ctx, handoff.expectation)
    await verifyLastTurn(deps, ctx, handoff.expectation, task)
  } else {
    ctx.trace.push({ agentId, agentName: agent.name, reply: content })
  }
}

/**
 * Checks the most recent trace entry (the handoff target's reply) against the
 * expectation. Unsatisfied + budget remaining → exactly one retry, same
 * agent, expectation restated, handoff tool withheld (forces a direct,
 * resolving reply rather than another handoff). Still unsatisfied, or no
 * budget left for a retry → the turn stays flagged unresolved.
 */
async function verifyLastTurn(
  deps: RunTeamChainDeps,
  ctx: RunContext,
  expectation: string,
  task: string,
): Promise<void> {
  const lastTurn = ctx.trace[ctx.trace.length - 1]
  const verdict = await verifyCommitment(deps.router, deps.defaultModel, expectation, lastTurn.reply)
  lastTurn.unresolved = !verdict.satisfied
  lastTurn.verificationNote = verdict.note

  if (verdict.satisfied || ctx.turnBudget <= 0) return

  ctx.turnBudget -= 1
  const retryAgentId = lastTurn.agentId
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
  const { content: retryContent } = await deps.router.chatWithTools(model, messages, [])
  writeAgentNote(deps.noteStore, retryAgentId, agent.name, retryContent)

  const retryVerdict = await verifyCommitment(deps.router, deps.defaultModel, expectation, retryContent)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/__tests__/run-team-chain.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/run-team-chain.ts packages/core/src/agents/__tests__/run-team-chain.test.ts
git commit -m "feat(core): add runTeamChain orchestrator (classify, handoff, verify)"
```

---

### Task 6: Rewrite `team.ts`, delete `BossAgent`

**Files:**
- Modify: `packages/core/src/api/routes/team.ts`
- Delete: `packages/core/src/agents/boss-agent.ts`
- Delete: `packages/core/src/agents/__tests__/boss-agent.test.ts`

**Interfaces:**
- Consumes: `runTeamChain`, `RunTeamChainDeps` (Task 5), plus pre-existing `ModelRouter`, `AgentRegistry`, `TeamChannel`, `NoteStore`, `DomainClassifier`, `loadConfig`.
- Produces: `POST /api/team/run` now returns `{ trace: TurnRecord[] }` instead of `{ reply, subtaskCount, subtasks }` — this is the contract Task 7 (web `client.ts`) must match.

- [ ] **Step 1: Delete the old files**

```bash
git rm packages/core/src/agents/boss-agent.ts packages/core/src/agents/__tests__/boss-agent.test.ts
```

- [ ] **Step 2: Rewrite the route**

```typescript
// packages/core/src/api/routes/team.ts
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { ModelRouter } from '../../models/router.js'
import { AgentRegistry } from '../../agents/registry.js'
import { TeamChannel } from '../../agents/team-channel.js'
import { NoteStore } from '../../memory/notes.js'
import { DomainClassifier } from '../../routing/domain-classifier.js'
import { runTeamChain } from '../../agents/run-team-chain.js'
import type { TurnRecord } from '../../agents/run-context.js'
import { loadConfig } from '../../config.js'

export async function teamRoutes(fastify: FastifyInstance) {
  const config = loadConfig()
  const router = new ModelRouter({ ollamaUrl: config.ollamaUrl, vllmUrl: config.vllmUrl, airllmUrl: config.airllmUrl, defaultModel: config.defaultModel })
  const agentRegistry = new AgentRegistry(`${config.dataDir}/agents.db`)
  const channel = new TeamChannel()
  const noteStore = new NoteStore({ dataDir: `${config.dataDir}/team-notes` })
  const classifier = new DomainClassifier({
    ollamaUrl: config.ollamaUrl,
    routerModel: config.quantRouterModel,
    confidenceThreshold: config.routerConfidence,
  })

  fastify.post<{
    Body: { task: string; sessionId?: string }
    Reply: { trace: TurnRecord[] }
  }>('/api/team/run', {
    schema: {
      body: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string' },
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { task } = req.body
    const sessionId = req.body.sessionId ?? randomUUID()
    void sessionId // reserved: not yet threaded into runTeamChain — see spec's "Out of scope"
    const trace = await runTeamChain(
      { router, registry: agentRegistry, noteStore, channel, classifier, defaultModel: config.defaultModel },
      task,
    )
    return reply.send({ trace })
  })

  fastify.addHook('onClose', async () => {
    router.close()
    agentRegistry.close()
    noteStore.close()
  })
}
```

**Note on `sessionId`:** the old `BossAgent.run(task, sessionId)` accepted a `sessionId` but never used it either (dead parameter). `runTeamChain` doesn't take one — the `void sessionId` line makes the still-unused-but-accepted-for-API-compatibility status explicit rather than silent. Do not remove `sessionId` from the request schema; the web client still sends it and removing it would be an unrelated breaking change to the request contract (only the *response* contract is changing in this plan).

- [ ] **Step 3: Verify the core package still builds and the full suite is green**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors (confirms nothing else imports `boss-agent.js`)

Run: `cd packages/core && npx vitest run`
Expected: PASS, no failures — this also confirms deleting `boss-agent.test.ts` didn't leave a dangling reference anywhere else

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/api/routes/team.ts
git commit -m "feat(core): rewrite /api/team/run on runTeamChain, delete BossAgent"
```

---

### Task 7: Web — `TeamTurn` type and `client.ts`

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/pages/chat/types.ts`

**Interfaces:**
- Produces: `TeamTurn` (exported from `client.ts`, mirrors backend `TurnRecord` as a plain JSON-serializable shape), `CoreClient.runTeam(task, sessionId?): Promise<{ trace: TeamTurn[] }>`, `Message.trace?: TeamTurn[]` — consumed by Tasks 8 and 9.

- [ ] **Step 1: Update `client.ts`**

Find this in `packages/web/src/api/client.ts`:

```typescript
  async runTeam(task: string, sessionId?: string): Promise<{ reply: string; subtaskCount: number; subtasks: Array<{ subtaskId: string; reply: string }> }> {
    const res = await fetch(`${this.baseUrl}/api/team/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, sessionId }),
    })
    if (!res.ok) throw new Error(`Team run failed (${res.status})`)
```

Replace with:

```typescript
  async runTeam(task: string, sessionId?: string): Promise<{ trace: TeamTurn[] }> {
    const res = await fetch(`${this.baseUrl}/api/team/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, sessionId }),
    })
    if (!res.ok) throw new Error(`Team run failed (${res.status})`)
```

Add near the top of the file (alongside any other exported interfaces already declared there):

```typescript
export interface TeamTurn {
  agentId: string
  agentName: string
  reply: string
  handoffTo?: string
  expectation?: string
  unresolved?: boolean
  verificationNote?: string
}
```

- [ ] **Step 2: Update `types.ts`**

Find this in `packages/web/src/pages/chat/types.ts`:

```typescript
import type { AgentDomain } from '../../components/AgentThinkingAnimation'

export type MessageRole = 'user' | 'assistant' | 'approval' | 'team'

export interface Message {
  role: MessageRole
  content: string
  imageUrl?: string
  domain?: AgentDomain
  approvalId?: string
  agentId?: string
  agentName?: string
  toolName?: string
  cmd?: string
  resolved?: boolean
  subtasks?: Array<{ subtaskId: string; reply: string }>
  subtaskCount?: number
}
```

Replace with:

```typescript
import type { AgentDomain } from '../../components/AgentThinkingAnimation'
import type { TeamTurn } from '../../api/client'

export type MessageRole = 'user' | 'assistant' | 'approval' | 'team'

export interface Message {
  role: MessageRole
  content: string
  imageUrl?: string
  domain?: AgentDomain
  approvalId?: string
  agentId?: string
  agentName?: string
  toolName?: string
  cmd?: string
  resolved?: boolean
  trace?: TeamTurn[]
}
```

- [ ] **Step 3: Verify the web package still typechecks**

Run: `cd packages/web && npx tsc --noEmit`
Expected: errors in `Chat.tsx`, `TeamResult.tsx`, and `ChatPane.test.tsx` (they still reference `subtasks`/`subtaskCount`/the old `runTeam` shape) — this is expected and resolved by Tasks 8 and 9. Confirm the errors are *only* in those three files.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/client.ts packages/web/src/pages/chat/types.ts
git commit -m "feat(web): add TeamTurn type, update runTeam()/Message to trace shape"
```

---

### Task 8: Web — `TeamResult.tsx` renders the trace

**Files:**
- Modify: `packages/web/src/pages/chat/TeamResult.tsx`

**Interfaces:**
- Consumes: `Message` (Task 7, now has `trace?: TeamTurn[]` instead of `subtasks`/`subtaskCount`).

- [ ] **Step 1: Replace the component**

```tsx
// packages/web/src/pages/chat/TeamResult.tsx
import React, { useState } from 'react'
import { ChatBubble } from '../../components/ChatBubble'
import type { Message } from './types'

export const TeamResult = React.memo(function TeamResult({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false)
  const trace = msg.trace ?? []
  const lastTurn = trace[trace.length - 1]
  const priorTurns = trace.slice(0, -1)

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%] bg-gray-800 border border-cyan-900/60 rounded-2xl px-4 py-3 text-sm">
        <div className="flex items-center gap-2 mb-2 text-xs text-cyan-500 font-mono">
          <span>TEAM</span>
          <span className="text-gray-600">·</span>
          <span>{trace.length} {trace.length === 1 ? 'agent' : 'agents'}</span>
          {priorTurns.length > 0 && (
            <button onClick={() => setOpen(o => !o)} className="ml-auto text-gray-600 hover:text-gray-400">
              {open ? 'hide relay' : 'show relay'}
            </button>
          )}
        </div>

        {open && priorTurns.length > 0 && (
          <div className="mb-3 space-y-2 border-b border-gray-700 pb-3">
            {priorTurns.map((t, i) => (
              <div key={i} className="text-xs bg-gray-900 rounded p-2">
                <div className="text-gray-500 font-mono mb-1">
                  {t.agentName}
                  {t.handoffTo && (
                    <span className="text-gray-600"> → handed off to {t.handoffTo}{t.expectation ? `: ${t.expectation}` : ''}</span>
                  )}
                </div>
                <div className="text-gray-300">{t.reply}</div>
                {t.unresolved && (
                  <div className="mt-1 text-amber-500">
                    ⚠ commitment not verified{t.verificationNote ? ` — ${t.verificationNote}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {lastTurn && <div className="text-xs text-gray-500 font-mono mb-1">{lastTurn.agentName}</div>}
        <ChatBubble role="assistant" content={lastTurn?.reply ?? msg.content} />
        {lastTurn?.unresolved && (
          <div className="mt-2 text-xs text-amber-500">
            ⚠ commitment not verified{lastTurn.verificationNote ? ` — ${lastTurn.verificationNote}` : ''}
          </div>
        )}
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Verify the web package still typechecks**

Run: `cd packages/web && npx tsc --noEmit`
Expected: `TeamResult.tsx` no longer appears in the error list from Task 7 Step 3; `Chat.tsx` and `ChatPane.test.tsx` still do (resolved next).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/chat/TeamResult.tsx
git commit -m "feat(web): render team trace as a labeled relay with unresolved marker"
```

---

### Task 9: Web — `Chat.tsx` consumer and the `ChatPane.test.tsx` mock

**Files:**
- Modify: `packages/web/src/pages/Chat.tsx:243-250`
- Modify: `packages/web/src/components/ChatPane.test.tsx:14`

**Interfaces:**
- Consumes: `CoreClient.runTeam` (Task 7, now returns `{ trace: TeamTurn[] }`).

- [ ] **Step 1: Update `Chat.tsx`**

Find (around line 243):

```typescript
      if (teamMode) {
        const res = await coreClient.runTeam(text, currentSessionId)
        setMessages(m => [...m, { role: 'team', content: res.reply, subtasks: res.subtasks, subtaskCount: res.subtaskCount }])
        speakText(res.reply)
        if (Notification.permission === 'granted') {
          new Notification('Team run complete', { body: res.reply.slice(0, 100), icon: '/favicon.ico' })
        }
```

Replace with:

```typescript
      if (teamMode) {
        const res = await coreClient.runTeam(text, currentSessionId)
        const lastReply = res.trace[res.trace.length - 1]?.reply ?? ''
        setMessages(m => [...m, { role: 'team', content: lastReply, trace: res.trace }])
        speakText(lastReply)
        if (Notification.permission === 'granted') {
          new Notification('Team run complete', { body: lastReply.slice(0, 100), icon: '/favicon.ico' })
        }
```

Leave the rest of the `if (teamMode) { ... return }` block (the lines after this, including the `return`) untouched.

- [ ] **Step 2: Update the mock in `ChatPane.test.tsx`**

Find (around line 14):

```typescript
    runTeam: vi.fn().mockResolvedValue({ reply: '', subtasks: [], subtaskCount: 0 }),
```

Replace with:

```typescript
    runTeam: vi.fn().mockResolvedValue({ trace: [] }),
```

- [ ] **Step 3: Verify the web package typechecks and the suite is green**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors

Run: `cd packages/web && npx vitest run`
Expected: PASS, no failures

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Chat.tsx packages/web/src/components/ChatPane.test.tsx
git commit -m "feat(web): consume team trace shape in Chat.tsx, update test mock"
```

---

### Task 10: Full-repo verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full turbo build + test graph**

Run: `cd C:\Users\John\CoastalAI && npx turbo build test`
Expected: all tasks green, including `core` and `web`. This also confirms nothing outside `packages/core` or `packages/web` imported anything from `boss-agent.ts` (turbo would fail a downstream package's build if so).

- [ ] **Step 2: Manual smoke check (per project convention — UI change, must be exercised in a real browser before calling this done)**

Start the app (`pnpm --filter web dev` + `pnpm --filter core dev`, or via the desktop shell if that's the usual local workflow), open Chat, toggle "TEAM MODE" on, send a task designed to need two domains (e.g. "we're planning a new feature — what's the engineering approach and what will it cost?"). Confirm:
- The reply renders with a "TEAM" badge and an agent count.
- "show relay" appears when more than one agent spoke, and reveals the handoff line + expectation.
- If a run happens to produce an unresolved commitment (harder to force deterministically — not required to reproduce, just confirm the code path renders sanely if `trace` contains an `unresolved: true` entry by temporarily hardcoding one in the mock during this check), the ⚠ marker is visible, not hidden.

- [ ] **Step 3: Update project memory**

This isn't a code step — after the above is green, note in the `project_coastal_multi_agent_os.md` memory file that the desktop team implementation is complete (commit range), so a future session doesn't re-derive this from git log.

---

## Self-Review Notes

- **Spec coverage:** every row in the spec's "Locked decisions" table maps to a task — entry point (Task 6), chain topology + cycle guard + cost guard (Task 1), runaway backstop (Task 5), within-chain context (Task 5's `traceAsMessages`), cross-task memory (Task 4), memory write policy (Task 4, called every turn from Task 5), handoff shape + commitment verification (Tasks 2, 3, 5), `BossAgent` deletion (Task 6), UI (Tasks 8, 9).
- **Placeholder scan:** none — every step has real, complete code.
- **Type consistency:** `TurnRecord` (core, Task 1) and `TeamTurn` (web, Task 7) are intentionally two separate-but-identical interfaces across the API boundary (no shared types package in this monorepo today — matches how `Message`'s other fields are already handled). Field names match exactly (`agentId`, `agentName`, `reply`, `handoffTo`, `expectation`, `unresolved`, `verificationNote`) — verified line-by-line against each other while writing this plan.
