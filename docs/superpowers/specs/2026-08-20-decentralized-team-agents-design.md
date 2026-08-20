# Decentralized Team Agents (Desktop) — Design

> Status: approved 2026-08-20. Spec 1 of 2 — desktop souls team. The BC-250 cluster swarm
> (`coordination`/`planner-agent`, the "Main/Planner" role) gets its own spec afterward,
> applying the same no-head-orchestrator pattern to the distributed A2A case.

## Goal

Remove the head-orchestrator pattern from the desktop "team" (the CFO/CTO/COO/PM/etc. souls
in `packages/core`). Replace `BossAgent`'s decompose → fan-out → synthesize pipeline with
independent agents that recall a **shared memory store** before replying and can **hand off
directly to a peer** — no central planner ever sees or directs the whole task. Motivated by
peer-to-peer agent orchestration patterns now shipping in the ecosystem (Prime Agent: "running
agents can exchange messages and orchestrate one another without routing everything through
the user"; Hermes Agent: FTS5-backed self-curated memory, the same shape as the recall
substrate already built here).

**Correction (2026-08-20, post-approval):** the "Stanford study" cited as the original
motivation for this design does not exist as described — checked both papers directly.
Stanford HAI's *"Simulating Human Behavior with AI Agents"* is single-agent (one LLM + one
person's interview transcript, no team, no orchestrator, no shared memory). Stanford HAI's
*CooperBench* ("AI Coding Agents Fail at Teamwork") is real and relevant, but argues closer to
the opposite: two coding agents collaborating peer-to-peer perform *worse* than one agent
alone, giving agents a channel to message each other "had almost no impact," and the failure
mode is agents disregarding teammates and **not following through on commitments** — fixed not
by removing coordination but by adding **verification mechanisms that check commitments got
honored**. The architecture below still removes `BossAgent` (defensible on its own merits —
see Prime Agent), but adds an explicit commitment-verification step to the handoff mechanism in
direct response to CooperBench's actual finding, rather than assuming peer-to-peer messaging is
sufficient on its own.

## Context

- **Souls already exist**: `packages/core/src/agents/souls/*.md` (8 personas) +
  `AgentRegistry` (`registry.ts`) — the "individual personalities" layer needs no new work.
- **The head orchestrator to remove**: `BossAgent` (`boss-agent.ts`) — calls an LLM to
  decompose a task into subtasks, fans each one out via `router.chat` directly (not even
  routed through a specific soul agent), then calls an LLM again to synthesize a reply. Wired
  to `POST /api/team/run` (`api/routes/team.ts`), consumed by the web UI's "TEAM MODE" toggle
  in `Chat.tsx`/`TeamResult.tsx`.
- **`TeamChannel`** (`team-channel.ts`) is a pub/sub bus, currently posted to only by
  `BossAgent`'s fan-out — nobody subscribes to it today. It becomes the real peer-handoff
  transport.
- **Shared memory substrate already exists**: `NoteStore` (`memory/notes.ts`, FTS5 BM25) +
  `recallNotes`/`recallContextMessage` (`memory/recall.ts`, see
  `2026-07-06-note-recall-design.md`) — but it is **not yet wired into the desktop souls team
  at all**. Today it's only consumed by `coding-agent` (cluster side). This spec is the first
  consumer on the desktop side, and unlike coding-agent's opt-in-per-worker wiring, every
  soul agent uses it — there's no existing per-agent memory to migrate away from.
- **Separate subsystem, out of scope here**: the BC-250 cluster's `planner-agent` +
  `coordination` daemon (12-node role map, "Main/Planner" at slot 1) is a distributed A2A
  system, not in-process — different enough to need its own spec.

## Locked decisions

| Decision | Choice |
|---|---|
| Task entry point | `DomainClassifier` (unchanged) addresses the task to one agent — a switchboard, not an overseer |
| Chain topology | Multi-hop peer handoff, no fixed hop cap |
| Cycle guard | An agent already in `visited` cannot be re-invoked on the same task — bounds the chain to ≤ number of active souls |
| Cost guard | `turnBudget` (default 6) decrements per turn; at 0, the `handoff` tool is omitted from that turn's tool list (forces a direct reply, never a rejected call) |
| Runaway backstop | Hard wall-clock timeout per chain (90s) as a last-resort circuit breaker |
| Within-chain context | The live `trace` (this task's turns so far) is passed directly as context — synchronous, no recall lag |
| Cross-task memory | Every turn's reply is written to a shared `NoteStore` as a note (`kind: 'agent_note'`, `sourceType: 'agent'`, `sourceId: agentId`) after it completes |
| Memory write policy | Every turn, auto-logged — no explicit "remember" tool. Matches "share the same memories" literally; curator-agent's existing grading/pruning can point at this store later if it needs tidying |
| Handoff shape | `handoff(targetAgentId, expectation)` — a structured, checkable statement of what the target must deliver, not a freeform "reason" string. Freeform inter-agent messages are exactly what CooperBench found "had almost no impact" |
| Commitment verification | After a handoff turn's reply, a cheap LLM judge (`verifyCommitment`, same model tier as `DomainClassifier`'s fallback) checks the reply against the `expectation`. Unsatisfied → **one retry** on the same agent with the expectation restated (costs one `turnBudget`); still unsatisfied → turn is marked `unresolved: true` and the chain continues/closes as normal, but the trace carries the flag — never silently dropped |
| `BossAgent` | Deleted outright — no legacy/fallback mode (single call site, ~90 lines, YAGNI) |
| UI | Full trace shown as a visible relay (who spoke, why they handed off), last turn highlighted as the answer. "TEAM MODE" toggle and entry point unchanged |

## Architecture

```
POST /api/team/run { task, sessionId }
  → DomainClassifier.classify(task) → first agentId
  → runContext = { visited: new Set(), turnBudget: 6, trace: [] }
  → runChain(agentId, task, runContext):
      recall = recallContextMessage(sharedNoteStore, task)
      tools = baseTools + (canHandoffAnyTarget(runContext) ? [handoffTool] : [])
      reply = agent.chat([soul, ...recall, ...trace-as-context, task], tools)
      noteStore.create({ kind: 'agent_note', sourceType: 'agent', sourceId: agentId, body: reply, ... })
      if reply included a handoff(targetId, expectation) call and canHandoff(runContext, targetId):
        visited.add(agentId); turnBudget--
        targetReply = runChain(targetId, task, runContext)   // recurses, produces its own trace entry
        { satisfied, note } = verifyCommitment(expectation, targetReply.lastTurn.reply)
        if !satisfied and turnBudget > 0:
          turnBudget--
          targetReply = retry targetId with expectation restated
          { satisfied, note } = verifyCommitment(expectation, targetReply.lastTurn.reply)
        targetReply.lastTurn.unresolved = !satisfied
        targetReply.lastTurn.verificationNote = note
        trace.push({ agentId, reply, handoffTo: targetId, expectation }, ...targetReply.trace)
        return { trace }
      else:
        trace.push({ agentId, reply })
        return { trace }
  → reply { trace: TurnRecord[] }
```

### Components

- **Delete**: `boss-agent.ts`, `agents/__tests__/boss-agent.test.ts`.
- **New — `packages/core/src/agents/run-context.ts`**: the `RunContext` type
  (`{ visited: Set<string>, turnBudget: number, trace: TurnRecord[] }`) and a pure
  `canHandoff(ctx: RunContext, targetId: string): boolean` (checks `turnBudget > 0 &&
  !visited.has(targetId) && targetId is a known active agent`). Pure function — easy to unit
  test without any LLM/registry mocking.
- **New — `packages/core/src/agents/handoff.ts`**: builds the per-turn tool list (offers
  `handoff` only when at least one valid target exists per `canHandoff`) and executes a
  handoff by recursing into the target agent with the updated `RunContext`. Posts the handoff
  event on `TeamChannel` (`from → to`, expectation) so future UI/observability can subscribe.
- **New — `packages/core/src/agents/verify-commitment.ts`**: `verifyCommitment(expectation:
  string, reply: string): Promise<{ satisfied: boolean; note: string }>` — one small/fast LLM
  call (same tier as `DomainClassifier`'s LLM fallback) that judges whether `reply` addresses
  `expectation`. Called by `handoff.ts` after a target agent's turn; drives the one-retry policy
  and the `unresolved` flag on the `TurnRecord`. This is the direct response to CooperBench's
  finding that freeform agent-to-agent messages don't get honored without a check.
- **Modify — `api/routes/team.ts`**: replace `BossAgent` construction with classify → build
  initial `RunContext` → `runChain` → return `{ trace }`. Instantiate one shared `NoteStore`
  at this scope (`${config.dataDir}/team-notes.db`) so every soul agent reads/writes the same
  store.
- **New note kind**: register `'agent_note'` via `kinds-registry.ts`'s `registerKind()` at
  core startup (alongside the existing 8 `CORE_KINDS`).
- **Web UI**: `TeamResult.tsx` renders `trace` as a labeled relay — agent name, reply,
  "→ handed off to {agent}: {expectation}" between turns — with the last entry visually
  highlighted. A turn with `unresolved: true` renders a visible warning marker (not hidden) —
  the whole point of adding verification is that a dropped commitment must be seen, not
  silently swallowed the way CooperBench's agents silently dropped teammates' questions.
  `Chat.tsx`'s response-shape consumer updates from `{reply, subtaskCount, subtasks}` to
  `{trace}`; the "TEAM MODE" toggle and "DEPLOY" copy are unchanged.

## Error handling

| Condition | Behavior |
|---|---|
| `recallContextMessage` throws/empty | Already fail-open in `recall.ts` — returns `null`, no injection, chain proceeds unchanged |
| Note write fails (e.g. SQLite busy) | Logged, swallowed — a memory-write failure must never fail the user-facing reply |
| Handoff to invalid/unknown/already-visited agent | Structurally impossible — the tool's target enum is built from `canHandoff`-filtered active agents each turn, so the LLM cannot request an invalid target |
| `turnBudget` reaches 0 | `handoff` tool omitted from that turn — the agent is forced to close with a direct reply, never a rejected call |
| Chain exceeds 90s wall-clock | Hard-aborted; the trace so far is returned with a final synthetic entry noting the timeout |
| `verifyCommitment` itself throws/times out | Fail-open toward visibility, not silence: treat as `satisfied: false` with `note: 'verification unavailable'` so it still surfaces as `unresolved` rather than being swallowed like a normal recall failure |
| Retry still unsatisfied, or `turnBudget` hits 0 before a retry can run | Turn stays marked `unresolved: true`; chain does not loop indefinitely trying to satisfy one expectation |

## Testing

- **Unit — `run-context.ts`**: `canHandoff` — visited-target rejection, budget-zero rejection,
  unknown-agent rejection, valid case.
- **Unit — `handoff.ts`**: mocked `AgentRegistry`/router — tool list shrinks correctly as
  budget/visited change across turns; handoff event posted on `TeamChannel`.
- **Unit — `verify-commitment.ts`**: mocked LLM call — satisfied case, unsatisfied case,
  judge-call throws → `{ satisfied: false, note: 'verification unavailable' }` (fail-open
  toward visibility, per Error handling).
- **Unit — `team.ts` route**: single-turn (classifier picks one agent, no handoff), multi-hop
  (2-3 turn chain), budget-exhausted forced-close, unknown classifier domain falls back to
  `general`, unsatisfied commitment triggers exactly one retry then marks `unresolved`,
  unsatisfied commitment with `turnBudget` already at 0 marks `unresolved` with no retry
  attempted.
- **Integration — real `NoteStore`** (temp dir): a note written by agent A during task 1 is
  recallable by agent B during an unrelated later task 2 — proves the "shared memory across
  tasks" property, not just within-chain context passing.
- Existing core test suite must stay green. This spec does not touch `coordination` or any
  cluster/BC-250 code.

## Scope

**In**: `run-context.ts`, `handoff.ts`, `verify-commitment.ts`, `team.ts` route rewrite,
`agent_note` kind registration, shared `NoteStore` wiring for the desktop team,
`TeamResult.tsx`/`Chat.tsx` response-shape update (including the `unresolved` marker),
deletion of `BossAgent`.

**Out**: the BC-250 cluster swarm redesign (separate spec, applies the same pattern to
`planner-agent`/`coordination` — and should re-examine CooperBench's findings again there,
since the cluster's concurrent multi-node work is closer to CooperBench's actual concurrent-
edit test setup than this sequential desktop baton-pass is); a dedicated handoff-observability
UI beyond the trace view; curator-agent wiring against `team-notes.db` (later, same one-liner
pattern as `coding-agent`'s recall adoption); changing `DomainClassifier`'s rules/LLM
classification logic itself; retraining or fine-tuning agents on coordination objectives
(CooperBench's other recommended fix — out of scope for a prompt/tool-level change).
