// packages/core/src/architect/db.ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openArchitectDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS work_items (
      id                  TEXT PRIMARY KEY,
      source              TEXT NOT NULL,
      source_ref          TEXT,
      title               TEXT NOT NULL,
      body                TEXT NOT NULL,
      target_hints        TEXT,
      acceptance          TEXT,
      budget_loc          INTEGER NOT NULL DEFAULT 200,
      budget_iters        INTEGER NOT NULL DEFAULT 5,
      approval_policy     TEXT NOT NULL DEFAULT 'plan-only',
      review_timeout_min  INTEGER NOT NULL DEFAULT 60,
      on_timeout          TEXT NOT NULL DEFAULT 'reject',
      priority            TEXT NOT NULL DEFAULT 'normal',
      status              TEXT NOT NULL DEFAULT 'pending',
      paused_reason       TEXT,
      paused_at           INTEGER,
      resumable           INTEGER NOT NULL DEFAULT 0,
      recurrence_count    INTEGER NOT NULL DEFAULT 0,
      escalated_at        INTEGER,
      allow_self_modify   INTEGER NOT NULL DEFAULT 0,
      created_by_user_id  TEXT,
      dedup_signature     TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      CHECK (status IN ('pending','active','awaiting_human','merged','cancelled','error','paused')),
      CHECK (priority IN ('high','normal','low')),
      CHECK (approval_policy IN ('full','plan-only','pr-only','none')),
      CHECK (on_timeout IN ('revise','reject','auto_approve')),
      CHECK (source IN ('ui','markdown','skill_md','github','skill_gap','curriculum'))
    );

    CREATE INDEX IF NOT EXISTS work_items_status_priority
      ON work_items(status, priority, created_at);

    CREATE INDEX IF NOT EXISTS work_items_dedup_active
      ON work_items(dedup_signature)
      WHERE status IN ('pending','active','awaiting_human');

    CREATE TABLE IF NOT EXISTS cycles (
      id              TEXT PRIMARY KEY,
      work_item_id    TEXT REFERENCES work_items(id) ON DELETE SET NULL,
      kind            TEXT NOT NULL DEFAULT 'normal',
      iteration       INTEGER NOT NULL DEFAULT 1,
      stage           TEXT NOT NULL,
      plan_text       TEXT,
      diff_text       TEXT,
      branch_name     TEXT,
      pr_url          TEXT,
      test_summary    TEXT,
      model_used      TEXT,
      failure_kind    TEXT,
      revise_context  TEXT,
      duration_ms     INTEGER,
      outcome         TEXT,
      error_message   TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      CHECK (stage IN ('planning','plan_review','building','pr_review','done','cancelled')),
      CHECK (kind IN ('normal','curriculum_scan')),
      CHECK (outcome IS NULL OR outcome IN ('merged','built','failed','vetoed','error','revised'))
    );

    CREATE INDEX IF NOT EXISTS cycles_work_item ON cycles(work_item_id, iteration);

    CREATE TABLE IF NOT EXISTS approvals (
      id               TEXT PRIMARY KEY,
      cycle_id         TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
      gate             TEXT NOT NULL,
      decision         TEXT NOT NULL,
      decision_revise  INTEGER NOT NULL DEFAULT 0,
      decided_by       TEXT,
      comment          TEXT,
      created_at       INTEGER NOT NULL,
      CHECK (gate IN ('plan','diff','merge')),
      CHECK (decision IN ('approved','rejected','revised','timeout','auto'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id              TEXT PRIMARY KEY,
      cycle_id        TEXT REFERENCES cycles(id) ON DELETE SET NULL,
      work_item_id    TEXT REFERENCES work_items(id) ON DELETE SET NULL,
      shadow_ref      TEXT NOT NULL,
      parent_id       TEXT REFERENCES snapshots(id) ON DELETE SET NULL,
      captured_at     INTEGER NOT NULL,
      captured_by     TEXT NOT NULL,
      note            TEXT,
      retention       TEXT NOT NULL DEFAULT 'short',
      CHECK (retention IN ('short','long','pinned'))
    );

    CREATE TABLE IF NOT EXISTS cycle_metrics (
      date           TEXT NOT NULL,
      metric         TEXT NOT NULL,
      value          REAL NOT NULL,
      count          INTEGER NOT NULL,
      PRIMARY KEY (date, metric)
    );

    CREATE TABLE IF NOT EXISTS curriculum_suppressions (
      id                TEXT PRIMARY KEY,
      signature         TEXT NOT NULL,
      suppressed_until  INTEGER NOT NULL,
      reason            TEXT NOT NULL,
      created_at        INTEGER NOT NULL,
      CHECK (reason IN ('vetoed','failed','duplicate'))
    );

    CREATE INDEX IF NOT EXISTS suppressions_active
      ON curriculum_suppressions(signature)
      WHERE suppressed_until > 0;

    CREATE TABLE IF NOT EXISTS architect_events (
      id              TEXT PRIMARY KEY,
      cycle_id        TEXT REFERENCES cycles(id) ON DELETE SET NULL,
      work_item_id    TEXT REFERENCES work_items(id) ON DELETE SET NULL,
      event_type      TEXT NOT NULL,
      payload         TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_work_item ON architect_events(work_item_id, created_at);
    CREATE INDEX IF NOT EXISTS events_type ON architect_events(event_type, created_at);

    -- user_profile holds the architect's behavior knobs per user. The
    -- architect stages read from here to adapt verbosity, gating, risk
    -- posture, etc. The 'default' row is created on first open.
    CREATE TABLE IF NOT EXISTS user_profile (
      id                       TEXT PRIMARY KEY,
      plan_verbosity           TEXT NOT NULL DEFAULT 'standard',
      auto_approve_threshold   TEXT NOT NULL DEFAULT 'never',
      test_strictness          TEXT NOT NULL DEFAULT 'must-pass',
      gate_policy              TEXT NOT NULL DEFAULT 'every-stage',
      tone                     TEXT NOT NULL DEFAULT 'standard',
      iteration_patience       TEXT NOT NULL DEFAULT 'stop-at-budget',
      risk_posture             TEXT NOT NULL DEFAULT 'balanced',
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER NOT NULL,
      CHECK (plan_verbosity IN ('brief','standard','detailed')),
      CHECK (auto_approve_threshold IN ('never','low-risk-only','aggressive')),
      CHECK (test_strictness IN ('must-pass','warn','advisory')),
      CHECK (gate_policy IN ('every-stage','plan-only','merge-only')),
      CHECK (tone IN ('terse','standard','explanatory')),
      CHECK (iteration_patience IN ('stop-at-2','stop-at-5','stop-at-budget')),
      CHECK (risk_posture IN ('conservative','balanced','experimental'))
    );
  `)

  // Ensure the default profile row exists. Idempotent.
  db.prepare(`
    INSERT OR IGNORE INTO user_profile (id, created_at, updated_at)
    VALUES ('default', ?, ?)
  `).run(Date.now(), Date.now())

  return db
}
