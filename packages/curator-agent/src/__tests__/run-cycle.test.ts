// packages/curator-agent/src/__tests__/run-cycle.test.ts
//
// Integration tests against a real NoteStore.

import { describe, it, expect, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { runCuratorCycle } from '../cycle/run-cycle.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'curator-test-'))
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }))
}

describe('runCuratorCycle', () => {
  it('returns a healthy-keep report when no notes exist', async () => {
    await withTempDir(async dir => {
      const report = runCuratorCycle({ dataDir: dir, dryRun: true })
      expect(report.notesScanned).toBe(0)
      expect(report.counts.keep).toBe(0)
      expect(report.counts.prune).toBe(0)
      expect(report.executed).toBeUndefined()
    })
  })

  it('grades a fresh note as keep', async () => {
    await withTempDir(async dir => {
      const store = new NoteStore({ dataDir: dir })
      store.create({ kind: 'cycle', title: 'just-made', body: '...' })
      store.close()

      const report = runCuratorCycle({ dataDir: dir, dryRun: true })
      // 1 note user-created + 1 curator-report note that gets written
      expect(report.notesScanned).toBeGreaterThanOrEqual(1)
      expect(report.counts.prune).toBe(0)
    })
  })

  it('flags an orphaned old note as prune', async () => {
    await withTempDir(async dir => {
      const ancient = Date.now() - 200 * MS_PER_DAY
      const store = new NoteStore({ dataDir: dir })
      const note = store.create({ kind: 'cycle', title: 'orphan', body: '' })
      // Backdate it
      ;(store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } })
        .db.prepare('UPDATE notes SET updated_at = ?, created_at = ? WHERE id = ?')
        .run(ancient, ancient, note.id)
      store.close()

      const report = runCuratorCycle({ dataDir: dir, dryRun: true })
      const verdict = report.verdicts.find(v => v.noteId === note.id)
      expect(verdict?.verdict).toBe('prune')
      expect(verdict?.reason).toMatch(/orphan|stale/)
    })
  })

  it('does NOT prune in dry-run mode', async () => {
    await withTempDir(async dir => {
      const ancient = Date.now() - 200 * MS_PER_DAY
      const store = new NoteStore({ dataDir: dir })
      const note = store.create({ kind: 'cycle', title: 'orphan', body: '' })
      ;(store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } })
        .db.prepare('UPDATE notes SET updated_at = ?, created_at = ? WHERE id = ?')
        .run(ancient, ancient, note.id)
      store.close()

      runCuratorCycle({ dataDir: dir, dryRun: true })
      const verifier = new NoteStore({ dataDir: dir })
      expect(verifier.get(note.id)).not.toBeNull()
      verifier.close()
    })
  })

  it('actually prunes in live mode', async () => {
    await withTempDir(async dir => {
      const ancient = Date.now() - 200 * MS_PER_DAY
      const store = new NoteStore({ dataDir: dir })
      const note = store.create({ kind: 'cycle', title: 'orphan', body: '' })
      ;(store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } })
        .db.prepare('UPDATE notes SET updated_at = ?, created_at = ? WHERE id = ?')
        .run(ancient, ancient, note.id)
      store.close()

      const report = runCuratorCycle({ dataDir: dir, dryRun: false })
      expect(report.executed?.pruned).toBeGreaterThanOrEqual(1)
      const verifier = new NoteStore({ dataDir: dir })
      expect(verifier.get(note.id)).toBeNull()
      verifier.close()
    })
  })

  it('never prunes user-kind notes regardless of age', async () => {
    await withTempDir(async dir => {
      const ancient = Date.now() - 10_000 * MS_PER_DAY // ~27 years old
      const store = new NoteStore({ dataDir: dir })
      const sacred = store.create({ kind: 'user', title: 'my note', body: '' })
      ;(store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } })
        .db.prepare('UPDATE notes SET updated_at = ?, created_at = ? WHERE id = ?')
        .run(ancient, ancient, sacred.id)
      store.close()

      const report = runCuratorCycle({ dataDir: dir, dryRun: false })
      const verdict = report.verdicts.find(v => v.noteId === sacred.id)
      expect(verdict?.verdict).toBe('keep')

      const verifier = new NoteStore({ dataDir: dir })
      expect(verifier.get(sacred.id)).not.toBeNull()
      verifier.close()
    })
  })

  it('detects consolidation: same kind + title in two notes', async () => {
    await withTempDir(async dir => {
      const store = new NoteStore({ dataDir: dir })
      const older = store.create({ kind: 'design', title: 'shared-title', body: 'first' })
      // Force the older one to have an earlier updatedAt
      ;(store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } })
        .db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?')
        .run(Date.now() - 1000, older.id)
      const newer = store.create({ kind: 'design', title: 'shared-title', body: 'second' })
      store.close()

      const report = runCuratorCycle({ dataDir: dir, dryRun: true })
      const olderVerdict = report.verdicts.find(v => v.noteId === older.id)
      const newerVerdict = report.verdicts.find(v => v.noteId === newer.id)
      expect(olderVerdict?.verdict).toBe('consolidate')
      expect(olderVerdict?.consolidateInto).toBe(newer.id)
      expect(newerVerdict?.verdict).toBe('keep')
    })
  })

  it('writes a curator_report note that future cycles will see', async () => {
    await withTempDir(async dir => {
      const t0 = Date.now()
      runCuratorCycle({ dataDir: dir, dryRun: true, now: () => t0 })

      const store = new NoteStore({ dataDir: dir })
      const reports = store.list({ kind: 'curator_report' })
      expect(reports).toHaveLength(1)
      expect(reports[0].body).toContain('Curator cycle')
      expect(reports[0].body).toContain('dry-run')
      store.close()
    })
  })

  it('respects fileExists callback to prune dead code-graph entries', async () => {
    await withTempDir(async dir => {
      const store = new NoteStore({ dataDir: dir })
      const dead = store.create({
        kind: 'code', title: 'fn-foo',
        body: '',
        sourceType: 'file', sourceId: '/missing.ts',
      })
      const alive = store.create({
        kind: 'code', title: 'fn-bar',
        body: '',
        sourceType: 'file', sourceId: '/exists.ts',
      })
      store.close()

      const report = runCuratorCycle({
        dataDir: dir,
        dryRun: true,
        fileExists: (path) => path === '/exists.ts',
      })
      const deadVerdict = report.verdicts.find(v => v.noteId === dead.id)
      const aliveVerdict = report.verdicts.find(v => v.noteId === alive.id)
      expect(deadVerdict?.verdict).toBe('prune')
      expect(deadVerdict?.reason).toMatch(/no longer exists/)
      expect(aliveVerdict?.verdict).toBe('keep')
    })
  })
})
