# Handoff — Coastal.AI v1.5.0 Plan 1 COMPLETE

**Date:** 2026-05-02
**Repo:** `C:\Users\John\CoastalAI` -> `https://github.com/CoastalCrypto/Coastal.AI`
**Branch:** `master`
**HEAD at handoff:** `5780724` (pushed to origin)

---

## Plan 1 Status: COMPLETE (13/13 chunks)

All chunks landed, reviewed, pushed. TSC clean. 79 tests green across 19 test files.

---

## Commit Log (Plan 1, all chunks)

| Chunk | Description | Commit(s) |
|---|---|---|
| 0 | Workspace plumbing | `ff30755`, `875743f`, `3fc66c8` |
| 1 | Schema + shared types | `e9150a7`, `74d9fb1` |
| 2 | Work-item store + dedup | `3c7907b` |
| 3 | UI adapter (HTTP route) | `c060c26` |
| 4 | Markdown adapter | `90a555e` + polish `c9f2f9d` |
| 5 | SKILL.md adapter | `2cee583` + polish `dfdc42e` |
| 6 | Cycle store (state machine) | `f488ff5` + polish `ea3aedc` |
| 7 | ModelRouter client | `b84df2c` + polish `a1787e8` |
| 8 | Planning stage | `cdb6288` |
| 9 | Building stage | `30a850c` + polish `b192ab4` |
| 10 | Touched-package detection + gate runners | `b26cbff` |
| 11 | Locked-paths config expansion | `0b09b37` |
| 12 | Stage runner orchestrator | `3326a2c` + fix `5780724` |
| 13 | Daemon entry-point | `c664e21` |

---

## What Plan 1 Delivered

The **Architect 2.0 Backbone** — a queue-driven, self-healing autonomous improvement system:

### Data Layer
- **WorkItemStore** — CRUD + dedup on `architect.db`, priority queue, status machine
- **CycleStore** — per-attempt state machine: planning -> building -> done/cancelled, with revise tracking
- **Schema** — `work_items` + `cycles` tables in SQLite via better-sqlite3

### Input Adapters
- **UI adapter** — POST/GET HTTP routes for work items
- **Markdown adapter** — watches `.architect/queue.md`, parses `## Title` sections with optional YAML
- **SKILL.md adapter** — watches `.architect/skills/*.md` (Agent Zero / Space Agent compatible)

### Processing Pipeline
- **Planning stage** — pure function: builds prompt from work item + source snippets, calls model client, parses `<plan>/<diff>` blocks, validates locked paths + budget
- **Building stage** — sequential gates: apply diff -> lint -> typecheck -> build -> tests, stops at first failure
- **Gate runners** — `pnpm --filter` wrappers scoped to touched packages only
- **Touched-package detection** — parses diff paths to workspace package names
- **Stage runner orchestrator** — plan -> build loop with soft-fail revise (exponential cooldown), hard-fail pause, budget exhaustion -> cancelled

### Infrastructure
- **ModelRouter client** — architect-side wrapper with callPlan/callSummary, min-capability preflight
- **Locked-paths config** — regex-based deny list with self-modify guard, operator overrides
- **Workspace map** — enumerates pnpm packages from package.json files
- **ArchitectDaemon** — poll-loop entry point with boolean lock, `CC_ARCHITECT_LEGACY` switch preserving legacy path

### Quality
- All I/O dependency-injected (testable without filesystem/network)
- Discriminated unions for all result types (ok/soft_fail/hard_fail)
- Immutable patterns throughout
- 79 tests, TSC clean

---

## Architecture Reference

### Key file map

```
packages/architect/src/
  daemon.ts                 — ArchitectDaemon class (Chunk 13)
  stage-runner.ts           — runWorkItemCycle orchestrator (Chunk 12)
  stages/planning.ts        — runPlanningStage pure function (Chunk 8)
  stages/building.ts        — runBuildingStage pure function (Chunk 9)
  gates.ts                  — pnpm --filter gate wrappers (Chunk 10)
  touched-packages.ts       — diff -> package names (Chunk 10)
  workspace-map.ts          — loadWorkspaceMapSync (Chunk 10)
  model-router-client.ts    — ArchitectModelRouterClient (Chunk 7)
  config.ts                 — locked paths, constants (Chunk 11)
  patcher.ts                — git apply/branch/merge (Chunks 0, 9)
  adapters/markdown.ts      — .architect/queue.md watcher (Chunk 4)
  adapters/skill-md.ts      — .architect/skills/*.md watcher (Chunk 5)
  index.ts                  — daemon entry point (Chunk 13)

packages/core/src/architect/
  types.ts                  — WorkItem, Cycle, enums (Chunk 1)
  db.ts                     — openArchitectDb (Chunk 1)
  store.ts                  — WorkItemStore (Chunk 2)
  cycle-store.ts            — CycleStore (Chunk 6)
```

### Key patterns
- Cross-package: `@coastal-ai/core/architect/types` (bare specifier)
- Intra-package: `./foo.js` (relative with .js extension)
- ESM, Node 22+, `module: Node16`, `moduleResolution: Node16`
- Windows: close db before rmSync in tests

### Known gaps / deferred items
- `'architect'` domain not registered in core's model router (workaround: Chunk 7 wrapper documents this)
- `runPlan`/`runBuild` closures in daemon's index.ts are TODO stubs (wired in Plan 2)
- `allowSelfModify` bypasses all locked paths, not just architect/ (guard at insertion boundary)
- Planning stage silently catches readSourceFile errors (acknowledged, not a correctness issue)

---

## What's Next: Plans 2-5

These plans have NOT been written yet. They need brainstorming -> spec -> plan -> implement.

| Plan | Theme | Estimated Chunks | Key Deliverables |
|---|---|---|---|
| 2 | PRs + Time-Travel Snapshots | ~6 | PR creation after build, shadow-git snapshots, restore mechanism, `gh` integration |
| 3 | Operator UX | ~10 | Mission Control dashboard, approval flow, mode switch, activity feed, CLI verbs, settings page |
| 4 | Curriculum + Ecosystem | ~5 | Idle-time self-improvement, SKILL.md export/import, curriculum suppressions |
| 5 | Reliability Dogfood + Release | ~5 | Seeded skill-gaps run, cherry-pick flow, receipts page, CHANGELOG, version bump |

### Plan 2 scope (from spec sections 2.3-2.4)
- PR creation gate: commit, `gh pr create`, PR body from plan text
- `pr_review` stage: SSE broadcast, approval/revise/reject flow
- Time-Travel shadow-git snapshots: `auto:plan`, `auto:building`, `manual` captures
- Snapshot restore: creates recovery branch, never auto-merges
- Retention: short (30d) / long (1y) / pinned
- Wire real `runPlan`/`runBuild` closures into daemon

### Resume command
> "Start Plan 2 brainstorming — PRs + Time-Travel Snapshots. Read the spec at `docs/superpowers/specs/2026-04-29-v1.5.0-self-healing-release-design.md` sections 2.3-2.4 (PR creation, Time-Travel snapshots) and this handoff for Plan 1 architecture context."
