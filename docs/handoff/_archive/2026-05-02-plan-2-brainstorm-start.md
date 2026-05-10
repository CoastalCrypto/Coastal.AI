# Handoff — Plan 2 Brainstorming In Progress

**Date:** 2026-05-02
**Repo:** `C:\Users\John\CoastalAI` -> `https://github.com/CoastalCrypto/Coastal.AI`
**Branch:** `master`
**HEAD at handoff:** (see latest commit after push)

---

## Plan 1 Status: COMPLETE

All 13 chunks landed, reviewed, pushed. 79 tests green, TSC clean.
Full details in `docs/handoff/2026-05-02-plan-1-complete.md`.

---

## Plan 2 Brainstorming: PRs + Time-Travel Snapshots

### Decision Made

**Approach A selected:** Full PR lifecycle (create + push + review-stage state machine) with human interaction via GitHub (operator merges via GH, daemon polls PR status via `gh pr view`). Dashboard UI deferred to Plan 3.

This makes Plan 2 self-contained for the git/GitHub workflow — the architect can close the loop end-to-end without the web dashboard.

### Three Subsystems Identified

1. **PR creation pipeline**
   - After build succeeds: commit on branch, `git push -u origin <branch>`, `gh pr create`
   - PR body: linked work item, plan text, test summary, model used, iteration count, attribution
   - Commit format: `chore(architect): {title}` with `Co-Authored-By: coastal-architect` + `Architect-Cycle: {id}` trailers
   - GH-issue source items: comment PR URL back on issue + label `architect-pr-open`
   - Markdown source items: replace entry with `<!-- moved to PR #N -->`
   - Hard-fail recovery: `env_gh` (gh missing/auth) and `env_push` (network), with branch-exists detection on resume
   - Edge case: branch lost between build and PR → soft revise consuming an iteration

2. **Time-Travel shadow-git snapshots**
   - Shadow repo at `data/.architect-snapshots/` (separate from real `.git`)
   - Auto captures: `auto:plan` (after plan accepted), `auto:building` (before git apply)
   - Manual captures: operator-initiated (Plan 3 UI, but the store/mechanism is Plan 2)
   - Restore: creates `architect/restore-<id>` branch in real repo, never auto-merges
   - Retention: short (30d), long (1y), pinned (never pruned, pins ancestors)
   - Pruning at daemon start
   - Schema: `snapshots` table tracking shadow commit SHA, captured_by, retention, pinned flag

3. **Wiring + `pr_review` stage**
   - Replace TODO stubs in daemon `index.ts` with real `runPlanningStage`/`runBuildingStage` closures
   - Register `'architect'` domain in core model router (or adapter)
   - `pr_review` stage state machine:
     - `none` policy: `gh pr merge --squash --auto`
     - `pr-only` / `plan-only`: PR parks, daemon polls `gh pr view` every 30s for merge status
     - `full`: PR opens as draft, requires human ready-for-review flip
   - Cycle outcome transitions: `built` -> `merged` when PR merges, or `vetoed` if PR closed without merge

### Remaining Brainstorming Questions

The next session should continue the brainstorming process:

1. **Snapshot schema:** Does the `snapshots` table belong in `architect.db` (alongside work_items/cycles) or a separate DB? Spec says `data/.architect-snapshots/` for the shadow git, but the metadata table location isn't explicit.

2. **PR polling mechanism:** The daemon currently has a single `tick()` that processes one pending work item. PR polling needs a separate concern — a work item in `pr_review` is neither pending nor done. Should we:
   - Add a second poll loop in the daemon for PR status checks
   - Use a single tick that checks both pending items AND items awaiting PR merge
   - Use a separate lightweight poller class

3. **Model router wiring:** The `ArchitectModelRouterClient` (Chunk 7) has a `ModelRouterLike` interface that doesn't match the real `ModelRouter` API. The header comment says "REMOVE OR UPDATE WHEN" the real adapter is built. Plan 2 needs to decide: thin adapter vs. update the interface.

4. **Scope boundary with Plan 3:** The spec mentions SSE events for approval broadcasts. Plan 2 should emit events (or at minimum record state transitions) that Plan 3 can consume, but not build the SSE infrastructure. What's the right seam?

### Resume Command

> "Continue Plan 2 brainstorming — approach A (full PR lifecycle via GitHub) is selected. Pick up from remaining questions: snapshot schema location, PR polling mechanism, model router wiring, and Plan 3 seam. Then propose 2-3 approaches, present design sections, write spec, and transition to writing-plans."

### Key Spec References

- PR creation: spec lines 444-471
- pr_review stage: spec lines 473-478
- Model routing: spec lines 479-495
- Time-Travel snapshots: spec lines 402-428
- Snapshot schema: spec lines 556-578 (curriculum section, but snapshot table is separate)
- Hard-fail recovery for PR: spec lines 463-469

### Architecture Context (from Plan 1)

```
packages/architect/src/
  daemon.ts                 — ArchitectDaemon class, tick() poll loop
  stage-runner.ts           — runWorkItemCycle orchestrator (plan -> build loop)
  stages/planning.ts        — runPlanningStage (pure function)
  stages/building.ts        — runBuildingStage (pure function)
  model-router-client.ts    — ArchitectModelRouterClient wrapper (ModelRouterLike interface)
  patcher.ts                — git apply/branch/merge/commit
  config.ts                 — locked paths, constants
  gates.ts                  — pnpm --filter gate wrappers
  touched-packages.ts       — diff -> package names
  workspace-map.ts          — loadWorkspaceMapSync
  index.ts                  — daemon entry point (CC_ARCHITECT_LEGACY switch)

packages/core/src/
  architect/types.ts        — WorkItem, Cycle, enums
  architect/db.ts           — openArchitectDb
  architect/store.ts        — WorkItemStore
  architect/cycle-store.ts  — CycleStore
  models/router.ts          — ModelRouter (real, domains: coo|cfo|cto|general, no 'architect' yet)
```

### Cost Optimization Notes

This session used model selection to reduce costs:
- **Haiku** for mechanical implementation (Chunks 10, 11)
- **Sonnet** for integration tasks (Chunk 12, 13) and all reviews
- **Opus** for orchestration and judgment calls only
- Pattern: haiku for "copy spec into code", sonnet for "coordinate across files", opus for architecture
