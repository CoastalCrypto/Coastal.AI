-- packages/coordination/src/store/schema.sql
--
-- Super-option schema (agreed 2026-05-26). See:
--   - docs/handoff/2026-05-26-multi-agent-os-plan.md
--   - packages/coordination/src/types.ts (TypeScript contract)
--
-- Three tables:
--   tasks              The work itself. 6-state lifecycle. owner_agent_id is
--                      denormalized from the active claim for fast "who owns
--                      this?" queries without a JOIN.
--   task_claims        Append-only audit log. Active claim has released_at = NULL.
--                      Handoff = INSERT new + UPDATE old in one transaction;
--                      task state stays 'claimed' across the swap.
--   task_dependencies  Directed edges. The dependency resolver transitions
--                      blocked → queued when must_complete deps are 'done';
--                      cascades to 'cancelled' when must_not_fail deps fail.

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  state           TEXT NOT NULL CHECK (state IN ('queued', 'claimed', 'blocked', 'done', 'failed', 'cancelled')),
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  result          TEXT,
  failure_reason  TEXT,
  owner_agent_id  TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  parent_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_state_created ON tasks(state, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_owner         ON tasks(owner_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent        ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_kind          ON tasks(kind);

CREATE TABLE IF NOT EXISTS task_claims (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL,
  claimed_at          INTEGER NOT NULL,
  last_heartbeat      INTEGER NOT NULL,
  released_at         INTEGER,
  release_reason      TEXT CHECK (release_reason IN ('completed', 'handoff', 'reclaimed', 'cancelled')),
  handoff_to_agent_id TEXT
);
-- Partial index on active claims — keeps zombie-detection sweep tiny and fast
-- even as the claim history grows unbounded.
CREATE INDEX IF NOT EXISTS idx_claims_active_heartbeat
  ON task_claims(last_heartbeat)
  WHERE released_at IS NULL;
-- "Who owns this task right now?" — fast lookup, expects at-most-one active.
CREATE INDEX IF NOT EXISTS idx_claims_task_active
  ON task_claims(task_id)
  WHERE released_at IS NULL;
-- Full claim history for a task, sorted by claim time — for audit queries.
CREATE INDEX IF NOT EXISTS idx_claims_task_history ON task_claims(task_id, claimed_at);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('must_complete', 'must_not_fail')),
  PRIMARY KEY (task_id, depends_on_task_id)
);
-- Reverse index — "what tasks depend on this one?" — needed when a dep
-- transitions and the resolver has to wake its dependents.
CREATE INDEX IF NOT EXISTS idx_deps_reverse ON task_dependencies(depends_on_task_id);
