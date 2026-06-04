// packages/architect/src/snapshots.ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { ulid } from '@coastal-ai/core/architect/ulid'

export interface SnapshotRecord {
  id: string
  cycleId: string | null
  workItemId: string | null
  shadowRef: string
  parentId: string | null
  capturedAt: number
  capturedBy: string
  note: string | null
  retention: 'short' | 'long' | 'pinned'
}

export interface SnapshotManagerOpts {
  repoRoot: string
  dataDir: string
  db: Database.Database
}

export interface CaptureOpts {
  cycleId: string | null
  workItemId: string | null
  capturedBy: string
  note?: string
  retention?: 'short' | 'long' | 'pinned'
}

export interface PruneOpts {
  shortMaxAgeMs?: number
  longMaxAgeMs?: number
}

const DEFAULT_SHORT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000   // 30 days
const DEFAULT_LONG_MAX_AGE_MS  = 365 * 24 * 60 * 60 * 1000  // 1 year

export class SnapshotManager {
  private readonly shadowGitDir: string

  constructor(private readonly opts: SnapshotManagerOpts) {
    this.shadowGitDir = join(opts.dataDir, '.architect-snapshots', '.git')
    this.ensureShadowRepo()
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  capture(captureOpts: CaptureOpts): SnapshotRecord {
    const { cycleId, workItemId, capturedBy, note, retention = 'short' } = captureOpts

    // Stage all files in the real working tree into the shadow repo's index
    execFileSync('git', ['add', '-A'], { cwd: this.opts.repoRoot, env: this.shadowEnv() })

    // Write the index as a tree object in the shadow repo
    const treeHash = execFileSync(
      'git',
      ['write-tree'],
      { cwd: this.opts.repoRoot, env: this.shadowEnv(), encoding: 'utf8' },
    ).trim()

    // Find parent commit (most recent snapshot for this context)
    const parentRef = this.getLatestRef()

    // Build commit-tree args
    const commitArgs = ['commit-tree', treeHash, '-m', `snapshot by ${capturedBy}`]
    if (parentRef !== null) {
      commitArgs.push('-p', parentRef)
    }

    const commitHash = execFileSync(
      'git',
      commitArgs,
      { cwd: this.opts.repoRoot, env: this.shadowEnv(), encoding: 'utf8' },
    ).trim()

    // Find parent snapshot id (most recent row in DB)
    const parentRow = this.opts.db
      .prepare('SELECT id FROM snapshots ORDER BY captured_at DESC LIMIT 1')
      .get() as { id: string } | undefined
    const parentId = parentRow?.id ?? null

    const id = ulid()
    const capturedAt = Date.now()

    this.opts.db.prepare(`
      INSERT INTO snapshots
        (id, cycle_id, work_item_id, shadow_ref, parent_id, captured_at, captured_by, note, retention)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cycleId, workItemId, commitHash, parentId, capturedAt, capturedBy, note ?? null, retention)

    return this.getById(id)!
  }

  restore(snapshotId: string): string {
    const snap = this.getById(snapshotId)
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`)

    const branchName = `architect/restore-${snapshotId}`

    // Create and switch to the restore branch in the real repo
    execFileSync('git', ['checkout', '-b', branchName], { cwd: this.opts.repoRoot })

    try {
      // Materialize the snapshot's tree into the real working tree.
      //
      // We let git write the files directly instead of piping `git archive`
      // into `tar x --overwrite`. The old approach was not portable: Windows
      // ships bsdtar, which does not understand GNU tar's `--overwrite` flag,
      // so the restore failed on Windows. `git checkout <ref> -- .` (run
      // against the shadow repo, with the real repo as its work tree) has the
      // same semantics — overwrite/add every tracked path from the snapshot,
      // leave untracked files alone — without spawning an external archiver.
      execFileSync(
        'git',
        ['checkout', snap.shadowRef, '--', '.'],
        { cwd: this.opts.repoRoot, env: this.shadowEnv() },
      )

      // Stage and commit the restored state
      execFileSync('git', ['add', '-A'], { cwd: this.opts.repoRoot })
      execFileSync(
        'git',
        ['commit', '-m', `revert(architect): restore workspace to ${snap.capturedAt}`],
        { cwd: this.opts.repoRoot },
      )
    } catch (err) {
      // On failure, switch back to master so the caller isn't stranded
      try {
        execFileSync('git', ['checkout', 'master'], { cwd: this.opts.repoRoot })
      } catch {
        // best-effort; ignore secondary failure
      }
      throw err
    }

    return branchName
  }

  listForCycle(cycleId: string): SnapshotRecord[] {
    const rows = this.opts.db
      .prepare('SELECT * FROM snapshots WHERE cycle_id = ? ORDER BY captured_at ASC')
      .all(cycleId) as any[]
    return rows.map(r => this.fromRow(r))
  }

  pin(snapshotId: string): void {
    const changes = this.opts.db
      .prepare("UPDATE snapshots SET retention = 'pinned' WHERE id = ?")
      .run(snapshotId)
    if (changes.changes === 0) throw new Error(`Snapshot not found: ${snapshotId}`)
  }

  prune(pruneOpts: PruneOpts = {}): number {
    const {
      shortMaxAgeMs = DEFAULT_SHORT_MAX_AGE_MS,
      longMaxAgeMs  = DEFAULT_LONG_MAX_AGE_MS,
    } = pruneOpts

    const now = Date.now()
    const shortCutoff = now - shortMaxAgeMs
    const longCutoff  = now - longMaxAgeMs

    // Fetch candidates (never touch pinned)
    const candidates = this.opts.db.prepare(`
      SELECT id, shadow_ref, retention, captured_at FROM snapshots
      WHERE retention != 'pinned'
        AND (
          (retention = 'short' AND captured_at < ?)
          OR
          (retention = 'long'  AND captured_at < ?)
        )
    `).all(shortCutoff, longCutoff) as Array<{ id: string; shadow_ref: string }>

    if (candidates.length === 0) return 0

    const deleteStmt = this.opts.db.prepare('DELETE FROM snapshots WHERE id = ?')

    let pruned = 0
    for (const row of candidates) {
      deleteStmt.run(row.id)
      pruned++
    }

    return pruned
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureShadowRepo(): void {
    if (existsSync(this.shadowGitDir)) return
    mkdirSync(this.shadowGitDir, { recursive: true })
    // init a bare git repo directly at the .git dir path
    execFileSync('git', ['init', '--bare', this.shadowGitDir])
    // configure identity so commit-tree doesn't fail
    execFileSync('git', ['config', 'user.email', 'architect@coastal.ai'], {
      env: { ...process.env, GIT_DIR: this.shadowGitDir },
    })
    execFileSync('git', ['config', 'user.name', 'Architect'], {
      env: { ...process.env, GIT_DIR: this.shadowGitDir },
    })
  }

  private shadowEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_DIR: this.shadowGitDir,
      GIT_WORK_TREE: this.opts.repoRoot,
    }
  }

  private getLatestRef(): string | null {
    try {
      const ref = execFileSync(
        'git',
        ['rev-parse', '--verify', '--quiet', 'HEAD'],
        { env: { ...process.env, GIT_DIR: this.shadowGitDir }, encoding: 'utf8' },
      ).trim()
      return ref || null
    } catch {
      return null
    }
  }

  private getById(id: string): SnapshotRecord | null {
    const row = this.opts.db
      .prepare('SELECT * FROM snapshots WHERE id = ?')
      .get(id) as any
    return row ? this.fromRow(row) : null
  }

  private fromRow(r: any): SnapshotRecord {
    return {
      id: r.id,
      cycleId: r.cycle_id,
      workItemId: r.work_item_id,
      shadowRef: r.shadow_ref,
      parentId: r.parent_id,
      capturedAt: r.captured_at,
      capturedBy: r.captured_by,
      note: r.note,
      retention: r.retention,
    }
  }
}
