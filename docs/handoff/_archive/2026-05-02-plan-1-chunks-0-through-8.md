# Handoff — Coastal.AI v1.5.0 "Self-Healing Release"

**Date:** 2026-05-02
**Repo:** `C:\Users\John\CoastalAI` → `https://github.com/CoastalCrypto/Coastal.AI`
**Branch:** `master`
**HEAD at handoff:** `cdb6288` (pushed to origin)

---

## Snapshot

Plan 1 of 5 ("Architect 2.0 Backbone") is **8 of 13 chunks landed**. All work is on `master` and pushed to `origin/master`.

Subagent-driven development workflow has been stable across all 8 chunks: implementer → spec-compliance review → code-quality review → optional polish-loop. Polish was applied on Chunks 4, 5, 6, and 7.

The full v1.5.0 effort has 5 plans. Only Plan 1 has been started.

---

## What landed (Plan 1, Chunks 0–8)

| Chunk | Description | Commit(s) |
|---|---|---|
| 0 | Workspace plumbing | (earlier session) |
| 1 | Schema + shared types (`packages/core/src/architect/types.ts`, `db.ts`) | (earlier session) |
| 2 | Work-item store + dedup | (earlier session) |
| 3 | UI adapter (HTTP route) | (earlier session) |
| 4 | Markdown adapter (`.architect/queue.md` watcher) | + polish `c9f2f9d` |
| 5 | SKILL.md adapter (`.architect/skills/*.md`) | `2cee583` + polish `dfdc42e` |
| 6 | Cycle store (state-machine persistence) | `f488ff5` + polish `ea3aedc` |
| 7 | ModelRouter client + min-capability gate | `b84df2c` + polish `a1787e8` |
| 8 | Planning stage (pure function, soft/hard-fail taxonomy) | `cdb6288` |

**Test totals at HEAD:** full architect suite 53/53 green; full `@coastal-ai/core` 277/277 (with one Windows-flaky native test excluded — see Notes).

---

## What's next (in priority order)

### Immediate — review Chunk 8

Chunk 8 (`cdb6288`) was committed by the implementer but has **not yet had spec-compliance or code-quality reviews run**. Standard workflow before Chunk 9 starts:

1. Dispatch spec compliance review against plan lines 2367–2638
2. Dispatch `superpowers:code-reviewer` against the new files
3. If polish is needed, dispatch a polish subagent
4. Then proceed to Chunk 9

### Plan 1 remaining (Chunks 9–13)

| Chunk | Description | Plan section |
|---|---|---|
| 9 | Building stage — apply + lint/type/build/test gates | lines 2640–2820 |
| 10 | Touched-package detection + gate runners | (read plan) |
| 11 | Locked-paths config (expanded from Chunk 8 stub) | (read plan) |
| 12 | Stage runner orchestrator (happy path + revise loop) | (read plan) |
| 13 | Daemon entry-point integration (poll loop) | (read plan) |

Plan: `docs/superpowers/plans/2026-04-29-v1.5.0-plan-1-backbone.md`

### Plans 2–5 (not yet started)

- **Plan 2** — PRs + Time-Travel Snapshots (~6 chunks)
- **Plan 3** — Operator UX (~10 chunks)
- **Plan 4** — Curriculum + Ecosystem (~5 chunks)
- **Plan 5** — Reliability Dogfood + Release (~5 chunks)

These plans have not been written yet — only Plan 1 exists. They would be written via the brainstorming → spec → plan → implement workflow once Plan 1 lands.

---

## Architecture context (for fresh sessions)

### Repo shape

TypeScript pnpm monorepo, Node 22+, ESM, `module: Node16`, `moduleResolution: Node16`.

- `packages/core` — shared types, schema, stores, model router, web tools
- `packages/architect` — the new "self-healing" autonomous agent (Plan 1's home)
- Cross-package imports use bare specifiers: `@coastal-ai/core/architect/types`
- Intra-package imports use relative `./foo.js` with the `.js` extension

### Architect data model

`packages/core/src/architect/types.ts` defines:

- **`WorkItem`** — single unit of work; `targetHints[]`, `budgetLoc`, `budgetIters`, `acceptance?`, `approvalPolicy`, `allowSelfModify`, etc.
- **`Cycle`** — state-machine record per attempt; `iteration`, `stage` (`planning | building | …`), `outcome` (`merged | built | failed | vetoed | error | revised`), `failureKind`, `reviseContext`
- Sources include `'ui' | 'markdown' | 'skill_md'`

### Adapters in place

- **UI** — HTTP route accepts work items
- **Markdown** — watches `.architect/queue.md`, parses `## Title` sections with optional fenced YAML
- **SKILL.md** — watches `.architect/skills/*.md` (Agent Zero / Space Agent compatible format), `.disabled` files filtered out

### Persistence

- SQLite via `better-sqlite3` (`Database.Database` type)
- `CycleStore.start` / `startRevise` / `terminate` / `setStage` — state machine with `outcome={merged,built}` → stage `done`, others → stage `cancelled`
- ULID for IDs (Crockford base32)
- **Windows quirk**: always `db.close()` BEFORE `rmSync(tempDir)` in test cleanup to avoid EPERM

### Model layer (Chunk 7)

`ArchitectModelRouterClient` (architect-side wrapper):

- `callPlan(prompt)` → high-priority architect-domain routing
- `callSummary(prompt)` → low-priority architect-domain routing
- `preflightCapability()` → returns `{ok, message?}` with operator-readable remediation
- `MinCapabilityError` — assigned model below `CC_ARCHITECT_MIN_TIER`
- `NoModelAssignedError` — router returned null

**Important deviation noted at top of `model-router-client.ts`**: the wrapper's `ModelRouterLike` interface is a *forward-facing contract*. The actual `ModelRouter` in `packages/core/src/models/router.ts` exposes `chat(messages, options?) → {reply, decision}`, has no tier field on descriptors, and hard-codes domains to `'coo'|'cfo'|'cto'|'general'` (no `'architect'` yet). A future chunk needs an adapter; today, real callers don't exist (only the test mocks). The header comment ends with a "REMOVE OR UPDATE WHEN…" trigger so it's clear when the comment is stale.

### Stage layer (Chunk 8)

`runPlanningStage(input) → PlanningResult` — pure function, dependency-injected:

- Takes `client`, `readSourceFile`, `lockedPathCheck` as closures (testable without filesystem/network)
- Parses `<plan>...</plan>` and `<diff>\`\`\`diff...\`\`\`</diff>` from model response
- Returns `{kind: 'ok', plan, diff, modelUsed}` or `{kind: 'soft_fail', failureKind: 'parse'|'locked'|'budget'}` or `{kind: 'hard_fail', failureKind: 'env_llm'}`

---

## Workflow used (for the next session)

This project uses **superpowers:subagent-driven-development**. Per chunk:

1. **Implementer** (`general-purpose` subagent) — writes code per plan body, with mandatory research-first when the plan flags it
2. **Spec compliance review** (`general-purpose` subagent, independent) — reads plan + implementation, calls APPROVE / CONCERNS / REJECT
3. **Code quality review** (`superpowers:code-reviewer` subagent) — flags bugs, footguns, missing tests
4. **Polish loop** if reviews surface non-trivial issues — dispatched as a fresh subagent with a tight brief listing exactly what to fix

Commits go directly to `master`. Each chunk is one feat commit + optional one polish commit. Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

### Plan-body counting errors observed

Two chunks' plan bodies had wrong test counts (Chunk 5 said "6 green" actual 5; Chunk 6 said "5 green" actual 6). Implementer briefs explicitly call this out so subagents don't get confused.

---

## Notes / known issues

- **Windows native crash** running the full `@coastal-ai/core` test suite via `pnpm --filter`: exit code `3221225477` (`STATUS_ACCESS_VIOLATION`). Root cause: `src/tools/backends/__tests__/native.test.ts > NativeBackend > executes a simple command` is flaky on Windows under load (timeout at 5000ms when run in parallel with the full suite). Re-running that file in isolation passes 4/4. **Unrelated to architect changes.** Workaround when validating chunks: run `pnpm --filter architect exec vitest run` (architect package only).
- **`.firecrawl/` directory** is untracked at repo root — pre-existing from before Chunks 5–8 work, not added by this session. Left as-is.
- **`'architect'` domain not yet registered** in core's hard-coded domain union (`coo|cfo|cto|general`). The Chunk 7 wrapper documents this in its header. A future chunk (likely between Chunks 12 and 13, or in Plan 2) needs to register the domain or wire an adapter.

---

## Files of interest for the next session

- **Plan**: `docs/superpowers/plans/2026-04-29-v1.5.0-plan-1-backbone.md`
- **Spec**: `docs/superpowers/specs/2026-04-29-v1.5.0-self-healing-release-design.md`
- **Architect package**: `packages/architect/src/`
  - `model-router-client.ts` (Chunk 7 — read header comment first)
  - `stages/planning.ts` (Chunk 8 — newest, not yet reviewed)
  - `adapters/markdown.ts`, `adapters/skill-md.ts` (Chunks 4–5)
  - `skill-md.ts` (Chunk 5 — frontmatter parser/serializer)
- **Core architect types/store**: `packages/core/src/architect/`
  - `types.ts` — single source of truth for `WorkItem`, `Cycle`, enums
  - `cycle-store.ts` (Chunk 6)
  - `store.ts` (Chunks 1–2 — work-item CRUD + dedup)
  - `db.ts` (Chunk 1 — schema)

---

## Resume command for next session

> "Resume Plan 1 — review Chunk 8 (`cdb6288`) per workflow, then proceed to Chunk 9 (building stage)."

Or for a fresh agent: read this handoff, then `docs/superpowers/plans/2026-04-29-v1.5.0-plan-1-backbone.md` lines **2640+** for Chunk 9.
