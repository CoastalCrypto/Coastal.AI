# Handoff — Coastal.AI v1.5.0 Plan 2 COMPLETE

**Date:** 2026-05-03
**Repo:** `C:\Users\John\CoastalAI` -> `https://github.com/CoastalCrypto/Coastal.AI`
**Branch:** `master`
**HEAD at handoff:** `e0acc1a` (pushed to origin)

---

## Plan 2 Status: COMPLETE (7/7 chunks)

108 tests green across 24 test files. TSC clean.

---

## Commit Log (Plan 2)

| Chunk | Description | Commit |
|---|---|---|
| 1 | Event log (Plan 3 SSE seam) | `9994b79` |
| 2 | Snapshot manager (shadow-git capture + restore + prune) | `f56252a` |
| 3 | PR creation stage (commit + push + gh pr create) | `b3e38e1` |
| 4 | PR review polling + auto-merge | `d76a41c` |
| 5 | Model router adapter (ModelRouter -> ModelRouterLike) | `a244787` |
| 6 | Stage runner integration (PR + snapshots + events wired) | `8c97d14` |
| 7 | Daemon two-phase tick + PR polling | `e0acc1a` |

---

## What Plan 2 Delivered

### PR Creation Pipeline
- `runPRCreationStage` — pure function: builds commit message with trailers, pushes branch, creates PR via injected `createPR` closure
- PR body: plan text, test summary, metadata table, attribution
- Draft mode when `approval_policy='full'`
- Hard-fail recovery: `env_push` (push fails) and `env_gh` (gh CLI fails) → cycle pauses, resume re-attempts
- Source backlinking for github-sourced items

### PR Review Stage
- `pollPRStatus` — polls `gh pr view`, returns merged/closed/open/error
- `triggerAutoMerge` — calls `gh pr merge --squash --auto`
- Daemon Phase 1 polls all `pr_review` cycles each tick
- Merged PR → `outcome='merged'`, work item status `'merged'`
- Closed PR (not merged) → `outcome='vetoed'`, work item `'cancelled'`

### Time-Travel Snapshots
- `SnapshotManager` — shadow-git repo at `data/.architect-snapshots/.git`
- `capture()` — `git add -A` + `git write-tree` + `git commit-tree` in shadow repo
- `restore()` — creates `architect/restore-<id>` branch in real repo from shadow commit
- `prune()` — removes `short` > 30d, `long` > 1y; pinned preserved
- `pin()` — changes retention to 'pinned'
- Auto-captures wired at `auto:building` in stage runner

### Model Router Adapter
- `createModelRouterAdapter` — bridges real `ModelRouter.chat()` + `CascadeRouter.route()` to `ModelRouterLike`
- Maps urgency (high/medium/low) to tier (apex/standard/lite)
- Routes through `'general'` domain (architect domain registration deferred)

### Event Log (Plan 3 Seam)
- `architect_events` table in `architect.db`
- `EventLog.emit()` / `listForWorkItem()` / `listSince()`
- Stage runner emits events at every transition (build_ok, pr_created, pr_failed, pr_merged, pr_closed)

### Infrastructure
- `CycleStore.listByStage()` — query cycles by stage (used for PR polling)
- `Patcher.pushBranch()` + `branchExistsOnRemote()` — git push + remote check
- Daemon two-phase tick: poll PRs first, then process pending items
- All new deps optional — Plan 1 callers unaffected

---

## Architecture Reference (Updated)

```
packages/architect/src/
  daemon.ts                 — ArchitectDaemon (two-phase tick: poll PRs + process pending)
  stage-runner.ts           — runWorkItemCycle (plan -> build -> PR creation -> pr_review)
  stages/planning.ts        — runPlanningStage (pure function)
  stages/building.ts        — runBuildingStage (pure function)
  stages/pr-creation.ts     — runPRCreationStage (pure function) [NEW]
  stages/pr-review.ts       — pollPRStatus + triggerAutoMerge [NEW]
  snapshots.ts              — SnapshotManager (shadow-git) [NEW]
  event-log.ts              — EventLog (architect_events table) [NEW]
  model-router-adapter.ts   — createModelRouterAdapter [NEW]
  model-router-client.ts    — ArchitectModelRouterClient wrapper
  patcher.ts                — git apply/branch/merge/commit/push
  config.ts                 — locked paths, constants
  gates.ts                  — pnpm --filter gate wrappers
  touched-packages.ts       — diff -> package names
  workspace-map.ts          — loadWorkspaceMapSync
  index.ts                  — daemon entry point (TODO stubs still present)

packages/core/src/architect/
  types.ts                  — WorkItem, Cycle, enums
  db.ts                     — schema (work_items, cycles, approvals, snapshots, architect_events, ...)
  store.ts                  — WorkItemStore
  cycle-store.ts            — CycleStore (+ listByStage) [MODIFIED]
```

### Remaining TODO in index.ts
The daemon's `index.ts` still has TODO stubs for `runPlan` and `runBuild` closures. These stubs return `hard_fail` immediately. To make the architect actually work end-to-end, the real closures need to be wired:
- `runPlan` → `runPlanningStage` via `ArchitectModelRouterClient` + `createModelRouterAdapter`
- `runBuild` → `runBuildingStage` with gate runners + workspace map
- `runPR` → `runPRCreationStage` with `Patcher` + `gh` CLI wrappers
- `captureSnapshot` → `SnapshotManager.capture()`
- `emitEvent` → `EventLog.emit()`
- `pollPR` → `pollPRStatus` with `gh pr view` wrapper

This wiring is mechanical but depends on having a running environment (Ollama model, gh auth, git remote). Best done as part of Plan 5 (Reliability Dogfood) where the real end-to-end test happens.

---

## What's Next: Plans 3-5

| Plan | Theme | Estimated Chunks | Key Deliverables |
|---|---|---|---|
| 3 | Operator UX | ~10 | Mission Control dashboard, approval flow, mode switch, activity feed, CLI verbs, settings |
| 4 | Curriculum + Ecosystem | ~5 | Idle-time self-improvement, SKILL.md export/import, curriculum suppressions |
| 5 | Reliability Dogfood + Release | ~5 | Real wiring of index.ts, seeded skill-gaps run, cherry-pick flow, receipts, CHANGELOG |

### Resume Command
> "Start Plan 3 brainstorming — Operator UX. Read the spec at `docs/superpowers/specs/2026-04-29-v1.5.0-self-healing-release-design.md` section 4 (Operator UX) and this handoff for architecture context."
