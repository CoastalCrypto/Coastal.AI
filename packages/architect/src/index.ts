// packages/architect/src/index.ts
import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { plan } from './planner.js'
import { Patcher } from './patcher.js'
import { runTests } from './validator.js'
import { waitForVeto } from './announcer.js'
import { SKILL_GAPS_THRESHOLD, VETO_TIMEOUT_MS, isLockedPath } from './config.js'
import Database from 'better-sqlite3'
import { openArchitectDb } from '@coastal-ai/core/architect/db'
import { WorkItemStore } from '@coastal-ai/core/architect/store'
import { CycleStore } from '@coastal-ai/core/architect/cycle-store'
import { UserProfileStore } from '@coastal-ai/core/architect/user-profile/store'
import { ArchitectDaemon } from './daemon.js'
import { runPlanningStage } from './stages/planning.js'
import { runBuildingStage } from './stages/building.js'
import { runPRCreationStage } from './stages/pr-creation.js'
import { pollPRStatus, triggerAutoMerge } from './stages/pr-review.js'
import { ModelRouter } from '@coastal-ai/core/models/router'
import { createModelRouterAdapter } from './model-router-adapter.js'
import { ArchitectModelRouterClient } from './model-router-client.js'
import { SnapshotManager } from './snapshots.js'
import { EventLog } from './event-log.js'
import { CurriculumScanner } from './curriculum/scanner.js'
import { SuppressionStore } from './curriculum/suppression-store.js'
import { findStaleTodos, findChurnHotspots } from './curriculum/signals.js'
import { runLintGate, runTypeGate, runBuildGate, runTestGate } from './gates.js'
import { loadWorkspaceMapSync } from './workspace-map.js'
import { findTouchedPackages } from './touched-packages.js'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { syncCodeGraph } from '@coastal-ai/core/memory/code-graph-sync'
import { getImpactSummaryForTargets } from '@coastal-ai/core/memory/impact'
import { scanCodeGraph } from './learnings/code-graph.js'

const REPO_ROOT    = process.env.CC_REPO_ROOT          ?? process.cwd()
const DATA_DIR     = process.env.CC_DATA_DIR            ?? join(REPO_ROOT, 'data')
const OLLAMA_URL   = process.env.CC_OLLAMA_URL          ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.CC_ARCHITECT_MODEL     ?? 'llama3.2'
const SERVER_URL   = process.env.CC_SERVER_URL          ?? 'http://localhost:4747'
const CHECK_INTERVAL_MS = Number(process.env.CC_ARCHITECT_INTERVAL_MS ?? '60000')
const AUTONOMOUS   = existsSync(join(DATA_DIR, '.architect-autonomous'))

function getAdminToken(): string {
  const envToken = process.env.CC_ADMIN_TOKEN
  if (envToken) return envToken
  const tokenFile = join(DATA_DIR, '.admin-token')
  if (existsSync(tokenFile)) return readFileSync(tokenFile, 'utf8').trim()
  return ''
}

function countUnreviewedGaps(): number {
  const dbPath = join(DATA_DIR, 'skill-gaps.db')
  if (!existsSync(dbPath)) return 0
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM skill_gaps WHERE reviewed = 0').get() as { cnt: number }
    return row.cnt
  } finally {
    db.close()
  }
}

async function runCycle(): Promise<void> {
  console.log('[coastal-architect] Starting improvement cycle...')

  const result = await plan({ dataDir: DATA_DIR, repoRoot: REPO_ROOT, ollamaUrl: OLLAMA_URL, model: OLLAMA_MODEL })
  if (!result) {
    console.log('[coastal-architect] Nothing to improve.')
    return
  }

  // Locked path guard
  const lockReason = isLockedPath(result.targetFile)
  if (lockReason) {
    console.warn(`[coastal-architect] ${lockReason} — skipping.`)
    return
  }

  console.log(`[coastal-architect] Proposal: ${result.summary}`)

  // Veto window (skip if autonomous mode)
  if (!AUTONOMOUS) {
    const decision = await waitForVeto({
      serverUrl: SERVER_URL,
      adminToken: getAdminToken(),
      summary: result.summary,
      diff: result.diff,
      vetoTimeoutMs: VETO_TIMEOUT_MS,
    })
    if (decision === 'vetoed') {
      console.log('[coastal-architect] Vetoed by user — aborting cycle.')
      return
    }
  }

  // Apply and test
  const branchName = `feature/self-improve-${new Date().toISOString().slice(0, 10)}`
  const patcher = new Patcher(REPO_ROOT)
  try {
    await patcher.createBranch(branchName)
    await patcher.applyDiff(result.diff)
    await patcher.commitChange(`chore(architect): ${result.summary}`)

    const testResult = runTests(REPO_ROOT)
    if (testResult.passed) {
      await patcher.checkoutMain()
      await patcher.mergeBranch(branchName)
      console.log(`[coastal-architect] Applied: ${result.summary} — ${testResult.summary}`)
      // Broadcast architect_applied event to UI via coastal-server
      try {
        await fetch(`${SERVER_URL}/api/admin/architect/applied`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() },
          body: JSON.stringify({ summary: result.summary, testsDelta: testResult.summary }),
        })
      } catch { /* Non-fatal — server may be restarting */ }
      // Signal coastal-server to restart gracefully
      if (process.env.CC_SERVER_PID) {
        if (process.platform === 'win32') {
          console.log('[coastal-architect] Restart signal not supported on Windows — restart the server manually.')
        } else {
          process.kill(Number(process.env.CC_SERVER_PID), 'SIGUSR2')
        }
      }
    } else {
      await patcher.checkoutMain()
      await patcher.deleteBranch(branchName)
      console.warn(`[coastal-architect] Tests failed — branch deleted. ${testResult.summary}`)
    }
  } catch (err) {
    // Ensure we return to main branch on error
    try { await patcher.checkoutMain() } catch {}
    try { await patcher.deleteBranch(branchName) } catch {}
    console.error('[coastal-architect] Cycle error:', err)
  }
}

async function main(): Promise<void> {
  console.log('[coastal-architect] Started.')

  // Write PID file so admin /run route can signal this process
  const pidFile = join(DATA_DIR, '.architect-pid')
  writeFileSync(pidFile, String(process.pid))

  if (process.env.CC_ARCHITECT_LEGACY !== '1') {
    // Queue-driven daemon (v1.5)
    const architectDb = openArchitectDb(join(DATA_DIR, 'architect.db'))

    // Build the model client once; shared across all closures.
    const MIN_TIER = (process.env.CC_ARCHITECT_MIN_TIER ?? 'low') as 'low' | 'medium' | 'high'
    const modelRouter = new ModelRouter({ ollamaUrl: OLLAMA_URL, defaultModel: OLLAMA_MODEL })
    const routerAdapter = createModelRouterAdapter(modelRouter as any)
    const modelClient = new ArchitectModelRouterClient(routerAdapter, { minTier: MIN_TIER })

    // Patcher for applying diffs and creating branches.
    const patcher = new Patcher(REPO_ROOT)

    // Snapshot and event-log singletons.
    const snapshotManager = new SnapshotManager({ repoRoot: REPO_ROOT, dataDir: DATA_DIR, db: architectDb })
    const eventLog = new EventLog(architectDb)

    // Workspace map (loaded once; packages are stable at startup).
    const workspaceMap = loadWorkspaceMapSync(REPO_ROOT)

    // Exec wrapper for gate runners: handles Windows (pnpm.cmd) vs Unix.
    const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    async function execGate(cmd: string, opts: { cwd: string }) {
      // cmd is e.g. "pnpm --filter core lint" — split off the "pnpm" prefix
      // that gates.ts prepends and use the platform-correct binary.
      const withoutPnpm = cmd.startsWith('pnpm ') ? cmd.slice(5) : cmd
      const args = withoutPnpm.split(/\s+/).filter(Boolean)
      const result = spawnSync(pnpmBin, args, {
        cwd: opts.cwd,
        encoding: 'utf8',
        shell: false,
      })
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.status ?? 1,
      }
    }

    // Curriculum scanner (disabled by default; operator sets CC_ARCHITECT_CURRICULUM=1).
    const suppressionStore = new SuppressionStore(architectDb)
    const curriculumScanner = new CurriculumScanner({
      workStore: new WorkItemStore(architectDb),
      cycleStore: new CycleStore(architectDb),
      suppressions: suppressionStore,
      repoRoot: REPO_ROOT,
      callLLM: (prompt) => modelClient.callSummary(prompt),
      harvestSignals: () => {
        let grepOut = ''
        try {
          const r = spawnSync(
            process.platform === 'win32' ? 'grep' : 'grep',
            ['-rn', '--include=*.ts', '--include=*.js', '-E', 'TODO|FIXME', '.'],
            { cwd: REPO_ROOT, encoding: 'utf8', shell: false },
          )
          grepOut = r.stdout ?? ''
        } catch { /* non-fatal */ }

        let gitOut = ''
        try {
          const r = spawnSync(
            'git',
            ['log', '--name-only', '--pretty=format:', '--since=90 days ago'],
            { cwd: REPO_ROOT, encoding: 'utf8', shell: false },
          )
          gitOut = r.stdout ?? ''
        } catch { /* non-fatal */ }

        return {
          staleTodos: findStaleTodos(grepOut),
          churnHotspots: findChurnHotspots(gitOut),
        }
      },
      isLockedPath,
      dailyBudget: Number(process.env.CC_CURRICULUM_DAILY_BUDGET ?? '1'),
    })

    // Profile store reads the seven preference knobs (test_strictness,
    // tone, etc.) per cycle so live edits via /api/admin/architect/user-profile
    // take effect on the next cycle without a daemon restart.
    const userProfileStore = new UserProfileStore(architectDb)

    // Note store + code-graph ingest. Opened once and reused across cycles;
    // the planner reads impact-radius prose from this on every runPlan call.
    // Lives in the same DATA_DIR as the core server so they share obsidian.db.
    const noteStore = new NoteStore({ dataDir: DATA_DIR })
    try {
      const scan = scanCodeGraph({ rootDir: REPO_ROOT })
      const syncResult = syncCodeGraph(noteStore, scan)
      console.log(
        `[coastal-architect] code-graph synced: ${syncResult.added} new, ${syncResult.updated} updated, ` +
        `${syncResult.removed} removed; ${syncResult.edgesAdded} edges added, ${syncResult.edgesRemoved} pruned`,
      )
    } catch (err) {
      // Non-fatal — the planner just won't see impact-radius prose this cycle.
      console.warn('[coastal-architect] code-graph sync failed:', err)
    }

    const daemon = new ArchitectDaemon({
      workStore: new WorkItemStore(architectDb),
      cycleStore: new CycleStore(architectDb),

      runPlan: async (input) => {
        const targetHints = input.workItem.targetHints ?? []
        // Resolve impact-radius prose from the notes layer. Empty string
        // when there's no graph data yet (e.g. fresh install before the
        // first scan completes) — planner falls back to current behavior.
        let impactSummary = ''
        try {
          impactSummary = getImpactSummaryForTargets(noteStore, targetHints)
        } catch (err) {
          console.warn('[coastal-architect] impact summary failed:', err)
        }
        return runPlanningStage({
          workItem: input.workItem,
          reviseContext: input.reviseContext ?? null,
          readSourceFile: async (relPath) => {
            return readFileSync(join(REPO_ROOT, relPath), 'utf8')
          },
          client: modelClient,
          lockedPathCheck: isLockedPath,
          impactSummary,
        })
      },

      runBuild: async (input) => {
        const { branchName, diff } = input
        const touchedPkgs = findTouchedPackages(diff, workspaceMap)
        const gateOpts = { cwd: REPO_ROOT, exec: execGate }
        const profile = userProfileStore.getDefault()
        return runBuildingStage({
          diff,
          applyDiff: async (d) => {
            await patcher.createBranch(branchName)
            await patcher.applyDiff(d)
          },
          runLint:      () => runLintGate(touchedPkgs, gateOpts),
          runTypecheck: () => runTypeGate(touchedPkgs, gateOpts),
          runBuild:     () => runBuildGate(touchedPkgs, gateOpts),
          runTests:     () => runTestGate(touchedPkgs, gateOpts),
          testStrictness: profile.testStrictness,
        })
      },

      runPR: async (input) => {
        return runPRCreationStage({
          ...input,
          commitAndPush: async (message, branch) => {
            await patcher.commitChange(message)
            await patcher.pushBranch(branch)
          },
          createPR: async ({ title, body, branchName: branch, draft }) => {
            const args = [
              'pr', 'create',
              '--title', title,
              '--body', body,
              '--head', branch,
            ]
            if (draft) args.push('--draft')
            const result = spawnSync('gh', args, {
              cwd: REPO_ROOT, encoding: 'utf8', shell: false, stdio: 'pipe',
            })
            if (result.status !== 0) {
              throw new Error(result.stderr?.trim() || 'gh pr create failed')
            }
            const prUrl = result.stdout.trim()
            const numMatch = prUrl.match(/\/pull\/(\d+)/)
            const prNumber = numMatch ? Number(numMatch[1]) : 0
            return { prUrl, prNumber }
          },
        })
      },

      pollPR: async (prUrl) => {
        return pollPRStatus({
          prUrl,
          ghView: async (url) => {
            const result = spawnSync(
              'gh', ['pr', 'view', url, '--json', 'state,mergedAt'],
              { cwd: REPO_ROOT, encoding: 'utf8', shell: false, stdio: 'pipe' },
            )
            if (result.status !== 0) {
              throw new Error(result.stderr?.trim() || 'gh pr view failed')
            }
            return JSON.parse(result.stdout) as { state: string; mergedAt: string | null }
          },
        })
      },

      autoMerge: async (prUrl) => {
        return triggerAutoMerge({
          prUrl,
          ghMerge: async (url) => {
            const result = spawnSync(
              'gh', ['pr', 'merge', url, '--squash', '--auto'],
              { cwd: REPO_ROOT, encoding: 'utf8', shell: false, stdio: 'pipe' },
            )
            if (result.status !== 0) {
              throw new Error(result.stderr?.trim() || 'gh pr merge failed')
            }
          },
        })
      },

      captureSnapshot: (opts) => {
        snapshotManager.capture({
          cycleId: opts.cycleId,
          workItemId: opts.workItemId,
          capturedBy: opts.capturedBy,
        })
      },

      emitEvent: (type, opts) => {
        eventLog.emit(type, opts)
      },

      isApprovalRequired: (gate) => {
        // Pre-v1.6 this read a stale .architect-mode file with a vocabulary
        // ('manual'/'semi') that didn't match what the route wrote, so it
        // was effectively a no-op. v1.6 sources gating from the user_profile
        // gate_policy knob, which the mode endpoint now fans out to.
        const policy = userProfileStore.getDefault().gatePolicy
        if (policy === 'every-stage') return true
        if (policy === 'plan-only')   return gate === 'plan'
        if (policy === 'merge-only')  return gate === 'pr'
        return false
      },

      curriculumScanner,
      curriculumEnabled: process.env.CC_ARCHITECT_CURRICULUM === '1',

      log: (msg) => console.log(`[coastal-architect] ${msg}`),
    })
    daemon.start(CHECK_INTERVAL_MS)
    console.log(`[coastal-architect] Queue-driven daemon started (interval: ${CHECK_INTERVAL_MS}ms)`)

    const cleanup = () => {
      daemon.stop()
      modelRouter.close()
      architectDb.close()
      try { unlinkSync(join(DATA_DIR, '.architect-pid')) } catch {}
      process.exit(0)
    }
    process.on('SIGTERM', cleanup)
    process.on('SIGINT', cleanup)
    return  // skip legacy path
  }

  let lastCount = countUnreviewedGaps()

  const interval = setInterval(async () => {
    const count = countUnreviewedGaps()
    if (count >= SKILL_GAPS_THRESHOLD && count > lastCount) {
      console.log(`[coastal-architect] Threshold reached (${count} gaps) — triggering cycle.`)
      lastCount = count
      await runCycle()
    }
    lastCount = count
  }, CHECK_INTERVAL_MS)

  process.on('SIGUSR1', async () => {
    console.log('[coastal-architect] Manual trigger received.')
    await runCycle()
  })

  const cleanup = () => {
    clearInterval(interval)
    try { unlinkSync(join(DATA_DIR, '.architect-pid')) } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  console.log(`[coastal-architect] Watching skill-gaps.db (threshold: ${SKILL_GAPS_THRESHOLD}, interval: ${CHECK_INTERVAL_MS}ms)`)
}

main().catch(e => { console.error('[coastal-architect] Fatal:', e); process.exit(1) })
