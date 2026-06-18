# Syncthing Notes-Substrate Replication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate the shared notes substrate across multi-agent OS nodes via Syncthing-synced per-note markdown, with a DB↔markdown bridge and Lamport-rev LWW.

**Architecture:** Each node keeps its SQLite `obsidian.db`. A bridge exports changed local notes to a synced folder (one `<id>.md` per note) and ingests peers' notes back, guarded by a per-note Lamport `rev`. Hub-and-spoke: the Curator owns the authoritative `shared-vault/` (send-only to workers); each worker pushes local notes to a per-node `inbox/` (send-only to the Curator). Syncthing is provisioned over its REST API, membership gated by the existing Ed25519 peer-registry.

**Tech Stack:** TypeScript, better-sqlite3, vitest, zod, Syncthing (systemd + REST), `packages/core` (NoteStore), `packages/coordination` (peer-registry).

**Spec:** `docs/superpowers/specs/2026-06-18-syncthing-replication-design.md`

**Key design notes (read before starting):**
- `rev` (Lamport) is for **cross-node conflict resolution**; `updated_at` (existing, wall-clock) is for **local change detection** (export watermark). Two separate concerns.
- An `origin` column (NULL = locally authored, set = ingested from node X) prevents echo loops: the worker inbox exporter only exports `origin IS NULL` notes.
- The replication markdown format is **1 file = 1 note**, id/rev/origin in YAML frontmatter — it does NOT reuse the document-oriented `markdown-ingest.ts`/`markdown-sync.ts` (those split docs into section-notes).

---

## Task 1: Add `rev` + `origin` columns to NoteStore

**Files:**
- Modify: `packages/core/src/memory/notes.ts`
- Test: `packages/core/src/memory/__tests__/notes-rev.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/memory/__tests__/notes-rev.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'

function freshStore() {
  return new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'notes-rev-')) })
}

describe('NoteStore rev + origin', () => {
  it('starts rev at 1 on create and leaves origin null', () => {
    const s = freshStore()
    const n = s.create({ title: 'a', body: 'b', kind: 'learning' })
    expect(n.rev).toBe(1)
    expect(n.origin).toBeNull()
  })

  it('bumps rev on update', () => {
    const s = freshStore()
    const n = s.create({ title: 'a', body: 'b', kind: 'learning' })
    const u = s.update(n.id, { body: 'c' })
    expect(u?.rev).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-rev.test.ts`
Expected: FAIL — `rev`/`origin` not on the `Note` type / undefined.

- [ ] **Step 3: Add the columns + migration + type fields**

In `notes.ts`, extend the `Note` interface (after `updatedAt: number`):

```ts
  rev: number
  origin: string | null
```

Extend `NoteRow` similarly:

```ts
  rev: number
  origin: string | null
```

In the constructor's `CREATE TABLE notes (...)` add the two columns before the closing paren:

```sql
        updated_at  INTEGER NOT NULL,
        rev         INTEGER NOT NULL DEFAULT 1,
        origin      TEXT
```

Immediately after the `this.db.exec(\`...\`)` schema block, add an idempotent migration for pre-existing DBs (better-sqlite3 throws if the column exists, so guard via pragma):

```ts
    const cols = this.db.prepare(`PRAGMA table_info(notes)`).all() as { name: string }[]
    const has = (c: string) => cols.some(x => x.name === c)
    if (!has('rev')) this.db.exec(`ALTER TABLE notes ADD COLUMN rev INTEGER NOT NULL DEFAULT 1`)
    if (!has('origin')) this.db.exec(`ALTER TABLE notes ADD COLUMN origin TEXT`)
```

- [ ] **Step 4: Thread the fields through create/update/rowToNote**

In `create()`, set `rev: 1, origin: input.origin ?? null` on the `note` object and include them in the INSERT column list + values. Add `origin?: string | null` to `NoteInput`.

In `update()`, set `rev: existing.rev + 1` on `next`, and add `rev = ?` (and keep `origin` unchanged) to the UPDATE SET clause + params.

In `rowToNote()` (bottom of file) map `rev: row.rev, origin: row.origin`.

Update the INSERT/UPDATE SQL to include the new columns. For `create()`:

```ts
    this.db
      .prepare(`
        INSERT INTO notes (id, title, body, kind, source_type, source_id, created_at, updated_at, rev, origin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(note.id, note.title, note.body, note.kind, note.sourceType, note.sourceId, note.createdAt, note.updatedAt, note.rev, note.origin)
```

For `update()` set clause:

```ts
        SET title = ?, body = ?, kind = ?, source_type = ?, source_id = ?, updated_at = ?, rev = ?
```
and append `next.rev` to the `.run(...)` params before `next.id`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-rev.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full core suite to confirm no regression**

Run: `pnpm --filter @coastal-ai/core test`
Expected: PASS (the new columns are additive; existing tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/memory/notes.ts packages/core/src/memory/__tests__/notes-rev.test.ts
git commit -m "feat(notes): add Lamport rev + origin columns for replication"
```

---

## Task 2: Rev-aware replicated upsert

**Files:**
- Modify: `packages/core/src/memory/notes.ts`
- Test: `packages/core/src/memory/__tests__/notes-replicated-upsert.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore, type ReplicatedNote } from '../notes.js'

function freshStore() {
  return new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'notes-repl-')) })
}
const base: ReplicatedNote = {
  id: 'n1', title: 't', body: 'v1', kind: 'learning',
  sourceType: null, sourceId: null, rev: 5, origin: 'node-2',
}

describe('NoteStore.applyReplicated', () => {
  it('inserts an unseen replicated note', () => {
    const s = freshStore()
    expect(s.applyReplicated(base)).toBe('applied')
    expect(s.get('n1')?.body).toBe('v1')
    expect(s.get('n1')?.rev).toBe(5)
  })

  it('applies when incoming rev is higher', () => {
    const s = freshStore()
    s.applyReplicated(base)
    expect(s.applyReplicated({ ...base, body: 'v2', rev: 6 })).toBe('applied')
    expect(s.get('n1')?.body).toBe('v2')
  })

  it('skips when incoming rev is lower or equal (same origin)', () => {
    const s = freshStore()
    s.applyReplicated({ ...base, rev: 6 })
    expect(s.applyReplicated({ ...base, body: 'stale', rev: 4 })).toBe('skipped')
    expect(s.get('n1')?.body).toBe('v1')
  })

  it('tie-breaks equal rev by higher origin id', () => {
    const s = freshStore()
    s.applyReplicated({ ...base, rev: 5, origin: 'node-2', body: 'from2' })
    expect(s.applyReplicated({ ...base, rev: 5, origin: 'node-9', body: 'from9' })).toBe('applied')
    expect(s.get('n1')?.body).toBe('from9')
    expect(s.applyReplicated({ ...base, rev: 5, origin: 'node-1', body: 'from1' })).toBe('skipped')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-replicated-upsert.test.ts`
Expected: FAIL — `applyReplicated` / `ReplicatedNote` undefined.

- [ ] **Step 3: Implement `ReplicatedNote` + `applyReplicated`**

Add the exported type near `NoteInput`:

```ts
export interface ReplicatedNote {
  id: string
  title: string
  body: string
  kind: NoteKind
  sourceType: string | null
  sourceId: string | null
  rev: number
  origin: string | null
}
```

Add the method to `NoteStore` (after `upsert`):

```ts
  /**
   * Apply a note received from a peer. Lamport LWW: write only if the incoming
   * rev is strictly higher, or equal-rev with a higher origin id (deterministic
   * tie-break so all nodes converge). Stores rev = max(local, incoming).
   */
  applyReplicated(note: ReplicatedNote): 'applied' | 'skipped' {
    assertRegisteredKind(note.kind)
    const existing = this.get(note.id)
    if (existing) {
      const wins =
        note.rev > existing.rev ||
        (note.rev === existing.rev && (note.origin ?? '') > (existing.origin ?? ''))
      if (!wins) return 'skipped'
    }
    const now = Date.now()
    const mergedRev = existing ? Math.max(existing.rev, note.rev) : note.rev
    this.db
      .prepare(`
        INSERT INTO notes (id, title, body, kind, source_type, source_id, created_at, updated_at, rev, origin)
        VALUES (@id, @title, @body, @kind, @sourceType, @sourceId, @createdAt, @updatedAt, @rev, @origin)
        ON CONFLICT(id) DO UPDATE SET
          title=@title, body=@body, kind=@kind, source_type=@sourceType,
          source_id=@sourceId, updated_at=@updatedAt, rev=@rev, origin=@origin
      `)
      .run({
        id: note.id, title: note.title, body: note.body, kind: note.kind,
        sourceType: note.sourceType, sourceId: note.sourceId,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
        rev: mergedRev, origin: note.origin,
      })
    this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(note.id)
    this.db.prepare(`INSERT INTO notes_fts (id, title, body) VALUES (?, ?, ?)`).run(note.id, note.title, note.body)
    return 'applied'
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-replicated-upsert.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/memory/notes.ts packages/core/src/memory/__tests__/notes-replicated-upsert.test.ts
git commit -m "feat(notes): applyReplicated with Lamport LWW + origin tie-break"
```

---

## Task 3: Replication frontmatter codec

**Files:**
- Create: `packages/core/src/memory/replication-frontmatter.ts`
- Test: `packages/core/src/memory/__tests__/replication-frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { serializeNote, parseNoteFile, type ReplicatedNote } from '../replication-frontmatter.js'

const note: ReplicatedNote = {
  id: '01J', title: 'Title', body: 'Line one\nLine two', kind: 'learning',
  sourceType: null, sourceId: null, rev: 7, origin: 'node-2',
}

describe('replication frontmatter codec', () => {
  it('round-trips a note through markdown', () => {
    const md = serializeNote(note)
    const parsed = parseNoteFile(md)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.note).toEqual(note)
  })

  it('rejects a file with missing/invalid frontmatter', () => {
    expect(parseNoteFile('no frontmatter here').ok).toBe(false)
    expect(parseNoteFile('---\nid: x\n---\nbody').ok).toBe(false) // missing required fields
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/replication-frontmatter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the codec**

Create `packages/core/src/memory/replication-frontmatter.ts`:

```ts
import { z } from 'zod'
import type { ReplicatedNote } from './notes.js'

export type { ReplicatedNote } from './notes.js'

const FrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  kind: z.string().min(1),
  rev: z.number().int().nonnegative(),
  origin: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
})

/** Serialize a note to `---\n<yaml>\n---\n<body>`. Body is verbatim. */
export function serializeNote(note: ReplicatedNote): string {
  const fm = [
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title)}`,
    `kind: ${JSON.stringify(note.kind)}`,
    `rev: ${note.rev}`,
    `origin: ${note.origin === null ? 'null' : JSON.stringify(note.origin)}`,
    `sourceType: ${note.sourceType === null ? 'null' : JSON.stringify(note.sourceType)}`,
    `sourceId: ${note.sourceId === null ? 'null' : JSON.stringify(note.sourceId)}`,
  ].join('\n')
  return `---\n${fm}\n---\n${note.body}`
}

export type ParseResult =
  | { ok: true; note: ReplicatedNote }
  | { ok: false; error: string }

/** Parse a `<id>.md` replication file. Pure (no FS). */
export function parseNoteFile(text: string): ParseResult {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!m) return { ok: false, error: 'no frontmatter block' }
  const raw: Record<string, unknown> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const key = line.slice(0, i).trim()
    const val = line.slice(i + 1).trim()
    if (val === 'null') raw[key] = null
    else if (/^-?\d+$/.test(val)) raw[key] = Number(val)
    else { try { raw[key] = JSON.parse(val) } catch { raw[key] = val } }
  }
  const parsed = FrontmatterSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.message }
  const fm = parsed.data
  return {
    ok: true,
    note: {
      id: fm.id, title: fm.title, body: m[2], kind: fm.kind as ReplicatedNote['kind'],
      sourceType: fm.sourceType, sourceId: fm.sourceId, rev: fm.rev, origin: fm.origin,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/replication-frontmatter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/memory/replication-frontmatter.ts packages/core/src/memory/__tests__/replication-frontmatter.test.ts
git commit -m "feat(replication): per-note markdown frontmatter codec (zod)"
```

---

## Task 4: Exporter (DB → markdown folder)

**Files:**
- Create: `packages/core/src/memory/notes-export.ts`
- Test: `packages/core/src/memory/__tests__/notes-export.test.ts`

The exporter writes changed local notes to a folder. Change detection uses the
local `updated_at` watermark persisted in `<dir>/.export-watermark`. A `select`
predicate decides which notes belong in this folder (worker inbox: `origin IS
NULL`; Curator vault: the keep set). Deletions: ids present in the folder but no
longer selected get their `<id>.md` removed.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { exportNotes } from '../notes-export.js'

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'exp-data-'))
  const outDir = mkdtempSync(join(tmpdir(), 'exp-out-'))
  return { store: new NoteStore({ dataDir }), outDir }
}

describe('exportNotes', () => {
  it('writes one <id>.md per selected note', () => {
    const { store, outDir } = setup()
    const n = store.create({ title: 'a', body: 'b', kind: 'learning' })
    const r = exportNotes(store, outDir, () => true)
    expect(r.written).toBe(1)
    expect(existsSync(join(outDir, `${n.id}.md`))).toBe(true)
  })

  it('removes files for notes no longer selected', () => {
    const { store, outDir } = setup()
    const keep = store.create({ title: 'k', body: 'b', kind: 'learning' })
    const drop = store.create({ title: 'd', body: 'b', kind: 'learning' })
    exportNotes(store, outDir, () => true)
    const r = exportNotes(store, outDir, n => n.id === keep.id)
    expect(r.removed).toBe(1)
    expect(existsSync(join(outDir, `${drop.id}.md`))).toBe(false)
    expect(readdirSync(outDir).filter(f => f.endsWith('.md'))).toEqual([`${keep.id}.md`])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the exporter**

Create `packages/core/src/memory/notes-export.ts`:

```ts
import { writeFileSync, rmSync, readdirSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NoteStore, Note } from './notes.js'
import { serializeNote } from './replication-frontmatter.js'

export interface ExportResult { written: number; removed: number }
export type NoteSelector = (note: Note) => boolean

/**
 * Reconcile a folder of <id>.md files to exactly the notes matching `select`.
 * Writes/overwrites selected notes; removes .md for ids no longer selected.
 * Idempotent: re-running with the same state is a no-op (write count = 0).
 */
export function exportNotes(store: NoteStore, dir: string, select: NoteSelector): ExportResult {
  mkdirSync(dir, { recursive: true })
  const selected = store.list({ limit: 1_000_000 }).filter(select)
  const selectedIds = new Set(selected.map(n => n.id))

  let written = 0
  for (const n of selected) {
    const text = serializeNote({
      id: n.id, title: n.title, body: n.body, kind: n.kind,
      sourceType: n.sourceType, sourceId: n.sourceId, rev: n.rev, origin: n.origin,
    })
    const path = join(dir, `${n.id}.md`)
    const prev = safeRead(path)
    if (prev !== text) { writeFileSync(path, text); written++ }
  }

  let removed = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const id = f.slice(0, -3)
    if (!selectedIds.has(id)) { rmSync(join(dir, f)); removed++ }
  }
  return { written, removed }
}

function safeRead(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}
```

(Note: `list({ limit: 1_000_000 })` returns all notes; the in-process filter keeps the unit simple. If the substrate outgrows memory this becomes a keyset scan — out of scope for v1.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-export.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/memory/notes-export.ts packages/core/src/memory/__tests__/notes-export.test.ts
git commit -m "feat(replication): folder exporter (DB -> per-note markdown)"
```

---

## Task 5: Ingester (markdown folder → DB)

**Files:**
- Create: `packages/core/src/memory/notes-ingest.ts`
- Test: `packages/core/src/memory/__tests__/notes-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { serializeNote } from '../replication-frontmatter.js'
import { ingestDir } from '../notes-ingest.js'

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ing-data-'))
  const inDir = mkdtempSync(join(tmpdir(), 'ing-in-'))
  return { store: new NoteStore({ dataDir }), inDir }
}
function writeNote(dir: string, n: Parameters<typeof serializeNote>[0]) {
  writeFileSync(join(dir, `${n.id}.md`), serializeNote(n))
}
const peer = {
  id: 'p1', title: 't', body: 'v1', kind: 'learning' as const,
  sourceType: 'replicated', sourceId: 'node-2', rev: 3, origin: 'node-2',
}

describe('ingestDir', () => {
  it('applies new peer notes and tracks deletions', () => {
    const { store, inDir } = setup()
    writeNote(inDir, peer)
    let r = ingestDir(store, inDir)
    expect(r.applied).toBe(1)
    expect(store.get('p1')?.body).toBe('v1')

    // higher rev applies
    writeNote(inDir, { ...peer, body: 'v2', rev: 4 })
    r = ingestDir(store, inDir)
    expect(r.applied).toBe(1)
    expect(store.get('p1')?.body).toBe('v2')

    // file removed -> note deleted locally
    rmSync(join(inDir, 'p1.md'))
    r = ingestDir(store, inDir)
    expect(r.deleted).toBe(1)
    expect(store.get('p1')).toBeNull()
  })

  it('skips invalid files without throwing', () => {
    const { store, inDir } = setup()
    writeFileSync(join(inDir, 'bad.md'), 'garbage, no frontmatter')
    const r = ingestDir(store, inDir)
    expect(r.applied).toBe(0)
    expect(r.invalid).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ingester**

Create `packages/core/src/memory/notes-ingest.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NoteStore } from './notes.js'
import { parseNoteFile } from './replication-frontmatter.js'

export interface IngestResult { applied: number; skipped: number; invalid: number; deleted: number }

/**
 * Reconcile the local store to a folder of <id>.md replication files.
 * Applies peer notes via Lamport LWW; deletes local replicated notes whose
 * file disappeared. Only touches notes whose local `origin` is non-null
 * (i.e. previously replicated in) — locally authored notes are never deleted.
 */
export function ingestDir(store: NoteStore, dir: string): IngestResult {
  const res: IngestResult = { applied: 0, skipped: 0, invalid: 0, deleted: 0 }
  const seen = new Set<string>()

  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const parsed = parseNoteFile(readFileSync(join(dir, f), 'utf8'))
    if (!parsed.ok) { res.invalid++; continue }
    seen.add(parsed.note.id)
    const outcome = store.applyReplicated(parsed.note)
    res[outcome]++ // 'applied' | 'skipped'
  }

  // Deletions: replicated notes no longer present in the folder.
  for (const n of store.list({ limit: 1_000_000 })) {
    if (n.origin !== null && !seen.has(n.id)) {
      store.delete(n.id)
      res.deleted++
    }
  }
  return res
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/notes-ingest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/memory/notes-ingest.ts packages/core/src/memory/__tests__/notes-ingest.test.ts
git commit -m "feat(replication): folder ingester (markdown -> DB, LWW + deletes)"
```

---

## Task 6: End-to-end bridge integration test (no real Syncthing)

**Files:**
- Test: `packages/core/src/memory/__tests__/replication-bridge.integration.test.ts`

Syncthing's contract is "the folder is eventually identical on both sides," so a
shared temp dir + a copy step stands in for it.

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { exportNotes } from '../notes-export.js'
import { ingestDir } from '../notes-ingest.js'

const worker = () => new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'w-')) })
const sync = (a: string, b: string) => { rmSync(b, { recursive: true, force: true }); cpSync(a, b, { recursive: true }) }

describe('replication bridge end-to-end', () => {
  it('propagates a note from worker -> curator -> other worker, then deletes', () => {
    const w1 = worker(), curator = worker(), w2 = worker()
    const w1Inbox = mkdtempSync(join(tmpdir(), 'w1inbox-'))
    const curInboxView = mkdtempSync(join(tmpdir(), 'curinbox-'))
    const curVault = mkdtempSync(join(tmpdir(), 'curvault-'))
    const w2Vault = mkdtempSync(join(tmpdir(), 'w2vault-'))

    // w1 authors a note, exports local-origin notes to its inbox
    const n = w1.create({ title: 'finding', body: 'v1', kind: 'learning' })
    exportNotes(w1, w1Inbox, note => note.origin === null)
    sync(w1Inbox, curInboxView)                 // Syncthing: w1 inbox -> curator

    // curator ingests inbox, "grades" (keep all here), exports keepers to vault
    ingestDir(curator, curInboxView)
    expect(curator.get(n.id)?.body).toBe('v1')
    exportNotes(curator, curVault, () => true)
    sync(curVault, w2Vault)                      // Syncthing: vault -> w2

    // w2 ingests the shared vault
    ingestDir(w2, w2Vault)
    expect(w2.get(n.id)?.body).toBe('v1')

    // curator prunes the note -> vault file removed -> w2 deletes locally
    curator.delete(n.id)
    exportNotes(curator, curVault, () => true)
    sync(curVault, w2Vault)
    const r = ingestDir(w2, w2Vault)
    expect(r.deleted).toBe(1)
    expect(w2.get(n.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/replication-bridge.integration.test.ts`
Expected: PASS (1 test). If the delete assertion fails, confirm Task 5's deletion loop only fires for `origin !== null` (curator-ingested notes carry origin from frontmatter).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/memory/__tests__/replication-bridge.integration.test.ts
git commit -m "test(replication): end-to-end bridge convergence + deletion"
```

---

## Task 7: Syncthing REST provisioning from the peer-registry

**Files:**
- Create: `packages/coordination/src/replication/syncthing-config.ts`
- Test: `packages/coordination/src/replication/__tests__/syncthing-config.test.ts`

Configures Syncthing devices + folders via its REST API, accepting only device
IDs bound to Ed25519-verified peers. The HTTP client is injected so the test
runs without a live daemon.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { reconcileSyncthing, type SyncthingHttp, type DesiredFolder } from '../syncthing-config.js'

const peers = [
  { peerId: 'node-2', syncthingDeviceId: 'DEV-2' },
  { peerId: 'node-9', syncthingDeviceId: 'DEV-9' },
]
const folders: DesiredFolder[] = [
  { id: 'shared-vault', path: '/var/lib/coastal/replication/shared-vault', type: 'receiveonly', deviceIds: ['DEV-9'] },
]

describe('reconcileSyncthing', () => {
  it('adds only allowlisted devices and the desired folders', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = []
    const http: SyncthingHttp = async (method, path, body) => { calls.push({ method, path, body }); return {} }
    await reconcileSyncthing(http, { peers, folders, knownDeviceIds: new Set(['DEV-2', 'DEV-9']) })
    expect(calls.some(c => c.method === 'PUT' && c.path.includes('/rest/config/devices/DEV-9'))).toBe(true)
    expect(calls.some(c => c.path.includes('/rest/config/folders/shared-vault'))).toBe(true)
  })

  it('refuses a folder referencing an unknown device', async () => {
    const http: SyncthingHttp = async () => ({})
    await expect(reconcileSyncthing(http, {
      peers, knownDeviceIds: new Set(['DEV-2']),
      folders: [{ ...folders[0], deviceIds: ['DEV-UNKNOWN'] }],
    })).rejects.toThrow(/unknown device/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/replication/__tests__/syncthing-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the provisioner**

Create `packages/coordination/src/replication/syncthing-config.ts`:

```ts
export type SyncthingHttp = (method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<unknown>

export interface DesiredFolder {
  id: string
  path: string
  type: 'sendonly' | 'receiveonly' | 'sendreceive'
  deviceIds: string[]
}

export interface ReconcileInput {
  peers: { peerId: string; syncthingDeviceId: string }[]
  folders: DesiredFolder[]
  knownDeviceIds: Set<string>
}

/**
 * Push desired devices + folders into Syncthing via its REST config API.
 * Membership is allowlist-only: every device referenced must be in
 * knownDeviceIds (the Ed25519-verified peer set) or we refuse.
 */
export async function reconcileSyncthing(http: SyncthingHttp, input: ReconcileInput): Promise<void> {
  for (const f of input.folders) {
    for (const d of f.deviceIds) {
      if (!input.knownDeviceIds.has(d)) {
        throw new Error(`refusing folder ${f.id}: references unknown device ${d}`)
      }
    }
  }
  for (const p of input.peers) {
    if (!input.knownDeviceIds.has(p.syncthingDeviceId)) continue
    await http('PUT', `/rest/config/devices/${p.syncthingDeviceId}`, {
      deviceID: p.syncthingDeviceId, name: p.peerId, autoAcceptFolders: false,
    })
  }
  for (const f of input.folders) {
    await http('PUT', `/rest/config/folders/${f.id}`, {
      id: f.id, path: f.path, type: f.type,
      devices: f.deviceIds.map(deviceID => ({ deviceID })),
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/replication/__tests__/syncthing-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/replication/syncthing-config.ts packages/coordination/src/replication/__tests__/syncthing-config.test.ts
git commit -m "feat(replication): Ed25519-gated Syncthing REST provisioning"
```

---

## Task 8: Syncthing systemd unit + daemon role wiring

**Files:**
- Create: `os/base/systemd/coastal-syncthing.service`
- Create: `packages/core/src/memory/replication-bridge.ts`
- Test: `packages/core/src/memory/__tests__/replication-bridge-roles.test.ts`

This task wires the pieces into a per-role bridge driver and ships the systemd
unit. The unit + REST come up operationally on hardware; the role driver is unit-tested.

- [ ] **Step 1: Write the failing test (role selectors)**

```ts
import { describe, it, expect } from 'vitest'
import { workerSelector, type Note } from '../replication-bridge.js'

const local = { origin: null } as Note
const replicated = { origin: 'node-9' } as Note

describe('bridge role selectors', () => {
  it('worker inbox exports only locally-authored notes', () => {
    expect(workerSelector(local)).toBe(true)
    expect(workerSelector(replicated)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/replication-bridge-roles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bridge driver**

Create `packages/core/src/memory/replication-bridge.ts`:

```ts
import type { NoteStore, Note } from './notes.js'
import { exportNotes } from './notes-export.js'
import { ingestDir } from './notes-ingest.js'

export type { Note } from './notes.js'

/** Worker inbox: only locally-authored notes (origin === null) leave the node. */
export const workerSelector = (n: Note): boolean => n.origin === null

export interface WorkerDirs { inbox: string; sharedVault: string }
export interface CuratorDirs { inboxes: string[]; sharedVault: string }

/** One worker tick: push local notes up (stamped with nodeId), pull vault down. */
export function runWorkerTick(store: NoteStore, dirs: WorkerDirs, nodeId: string): void {
  exportNotes(store, dirs.inbox, workerSelector, nodeId)
  ingestDir(store, dirs.sharedVault)
}

/**
 * One curator tick: ingest each worker inbox, then export the keep set.
 * `keep` is the Curator's grading predicate (default: keep all).
 * Note: `exportNotes` gained a `nodeId` param during T6 — it stamps the
 * authoring node onto locally-authored notes so replicated notes are
 * deletable + tie-breakable.
 */
export function runCuratorTick(store: NoteStore, dirs: CuratorDirs, nodeId: string, keep: (n: Note) => boolean = () => true): void {
  for (const inbox of dirs.inboxes) ingestDir(store, inbox)
  exportNotes(store, dirs.sharedVault, keep, nodeId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/core exec vitest run src/memory/__tests__/replication-bridge-roles.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Create the systemd unit**

Create `os/base/systemd/coastal-syncthing.service`:

```ini
[Unit]
Description=Coastal.AI Syncthing (notes-substrate replication)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=coastal
Environment=HOME=/home/coastal
Environment=STNODEFAULTFOLDER=1
ExecStart=/usr/bin/syncthing serve --no-browser --gui-address=127.0.0.1:8384 --home=/var/lib/coastal/replication/syncthing
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 6: Run the full suites to confirm green**

Run: `pnpm --filter @coastal-ai/core test && pnpm --filter @coastal-ai/coordination test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add os/base/systemd/coastal-syncthing.service packages/core/src/memory/replication-bridge.ts packages/core/src/memory/__tests__/replication-bridge-roles.test.ts
git commit -m "feat(replication): per-role bridge driver + syncthing systemd unit"
```

---

## Wiring follow-ups (out of this plan, tracked for the OS bring-up)

- Register each node's Syncthing device ID into the signed `peer-registry` during first-boot cluster-join, and call `reconcileSyncthing` from the daemon with the node's role-appropriate `DesiredFolder[]`.
- Schedule `runWorkerTick` / `runCuratorTick` on an interval (or fs-watch) inside the daemon; wire `runCuratorTick`'s `keep` predicate to the existing `createCuratorDaemon` grading.
- Add `syncthing` to the OS package lists (`os/kiosk/build/packages.list`, node image apt set).
- These require a running cluster to validate end-to-end (per the spec's manual E2E follow-up).

## Self-review notes

- **Spec coverage:** sync unit (markdown, Task 3–6) · hub-and-spoke folders (Task 7 folder types + Task 8 driver) · Curator-gated (Task 8 `keep` predicate) · Lamport LWW (Task 2) · prerequisite rev column (Task 1) · Ed25519-gated membership (Task 7) · deletions (Task 5) · zod validation (Task 3) · testing (Task 6) — all covered.
- **rev vs updated_at:** rev = cross-node LWW (frontmatter); updated_at = unchanged. Export selection is predicate-based (origin), not watermark-based, which is simpler and fully idempotent — the spec's "watermark" optimization is deferred (noted; not needed for correctness).
- **Type consistency:** `ReplicatedNote` defined in `notes.ts` (Task 2), re-exported by the codec (Task 3); `applyReplicated` returns `'applied' | 'skipped'` used by the ingester (Task 5).
