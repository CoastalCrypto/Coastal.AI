# Syncthing Notes-Substrate Replication — Design

> **Status:** approved 2026-06-18. Resolves the open decision in
> `docs/handoff/2026-05-26-multi-agent-os-plan.md` (line 431, "notes-substrate
> replication model") in favor of **Syncthing-based file replication of a
> markdown export**, hub-and-spoke, Curator-gated.

## Goal

Replicate the shared notes substrate across the 12-node multi-agent OS so every
role-agent can read a common, high-signal knowledge base — without corrupting the
per-node SQLite store and without standing up a bespoke sync protocol. Use
Syncthing as the transport; a thin DB↔markdown bridge does the translation.

**This is the knowledge substrate, not the task board.** The low-latency task
board / lossless DB stay on the existing A2A `packages/coordination` broadcast
`replicator.ts` (logical-clock-guarded). Syncthing replication is
eventually-consistent (seconds–minutes), which is correct for knowledge.

## Decisions (resolved during brainstorming)

1. **Sync unit:** a folder of per-note markdown files (`<note-id>.md`), **not** the
   live SQLite `obsidian.db` (syncing a hot SQLite file across peers corrupts it).
2. **Topology:** hub-and-spoke. The Curator/main node owns the authoritative
   shared vault (sole writer); workers hold receive-only read replicas and push
   their local notes up via per-node send-only inboxes.
3. **Share scope:** Curator-gated. Workers push *all* local notes to their inbox;
   the Curator grades and promotes only keepers into the shared vault.

## Architecture & data flow

The substrate remains a per-node SQLite `obsidian.db`
(`packages/core/src/memory/notes.ts`). Syncthing only ever moves folders of
`.md` files; a bridge in the Coastal.AI daemon translates DB↔folder per node.

```
WORKER node (e.g. Coder)                    CURATOR / main node
─────────────────────                       ───────────────────
local obsidian.db                           authoritative obsidian.db
  │  export changed notes                      │  grade inboxes → keep set
  ▼                                            ▼  export keepers
inbox/   ──Syncthing (send-only)──▶  inbox-<node>/  (receive-only)  ─┐
                                                                     │ ingest+grade
shared-vault/ (receive-only) ◀──Syncthing (send-only)── shared-vault/ (RW)
  │  ingest peers' notes
  ▼
local obsidian.db  ← read replica of the shared substrate
```

**Syncthing folders:**
- `shared-vault/` — one folder. **Curator = send-only** (sole writer); **every
  worker = receive-only** (read replica). No shared-vault write conflicts by
  construction.
- `inbox-<node>/` — one folder *per worker*, a 2-device cluster (that worker ↔
  Curator only). **Worker = send-only**; **Curator = receive-only.**

**Bridge behavior (in the daemon, by role):**
- **Worker:** `export(local DB → inbox/)` for changed notes;
  `ingest(shared-vault/ → local DB)` for peer notes.
- **Curator:** `ingest(each inbox-<node>/ → DB)` → grade → `export(keepers →
  shared-vault/)`.

## The DB↔markdown bridge

### Exporter — `packages/core/src/memory/notes-export.ts`
For each note whose logical clock advanced since the last export, write
`<note-id>.md` with YAML frontmatter:

```markdown
---
id: 01J...            # stable note id = filename
kind: learning
clock: 42             # Lamport rev (see "Required schema change")
sourceType: replicated
origin: node-2-coder  # which node authored this revision
edges: [01J...other]
updatedAt: 2026-06-18T12:00:00Z
---
<note body>
```

- Filename is the stable note id, so revisions overwrite in place (Syncthing
  diffs one file per note).
- Export is incremental: query `NoteStore` for notes with `clock` greater than
  the last-exported watermark; advance the watermark after a successful write.

### Ingester — `packages/core/src/memory/notes-ingest-watch.ts`
Watches the synced folder; on change, parses incoming `.md` via the existing
`markdown-ingest.ts` and applies via the existing `markdown-sync.ts`, **guarded
by the logical clock**:

- Apply an incoming note **only if `incoming.clock > local.clock`** for that id
  (Lamport LWW — same family as the A2A `replicator.ts` logical-clock guards). On
  a tie (`incoming.clock == local.clock`, different body), keep the higher
  `origin` node id deterministically so all nodes converge to the same winner.
- **Loop prevention:** the exporter writes the clock already in the DB, so a
  self-written file re-seen by the watcher has `incoming.clock == local.clock`
  → skipped. No echo loop.
- **Deletions:** removing `<id>.md` from a folder propagates via Syncthing; the
  ingester deletes that id from the local DB **scoped to `sourceType:
  replicated`** so user/local-authored notes are never touched. Syncthing
  reconciles deletes for nodes that were offline.
- **Validation:** frontmatter is parsed with a **zod schema**
  (`replication-frontmatter.ts`); invalid/partial files are skipped and logged,
  never crashing `NoteStore`.

### Frontmatter codec — `packages/core/src/memory/replication-frontmatter.ts`
Zod schema + `serialize(note) → frontmatter` and `parse(md) → {meta, body}`.
Single source of truth for the on-disk contract, shared by exporter + ingester.

## Provisioning & trust

- Syncthing runs as a **per-node systemd service**
  (`os/base/systemd/coastal-syncthing.service`); config + folders live on the
  writable overlay (`/var/lib/coastal/replication/...`); GUI/REST bound to
  `127.0.0.1:8384` only.
- The daemon configures devices + folders via Syncthing's **REST API** (api-key
  on the overlay) — no hand-editing — from
  `packages/coordination/src/replication/syncthing-config.ts`.
- **Ed25519 is the root of trust.** Each node's Syncthing **device ID is
  registered alongside its Ed25519 peer identity** in the existing signed
  `peer-registry` during first-boot cluster-join. Folder/device acceptance is
  **allowlist-only**: a Syncthing device is added only if bound to an
  Ed25519-verified peer. Unknown devices cannot join. Syncthing's TLS secures the
  wire; Ed25519 gates membership.

## Failure modes

| Failure | Behavior |
|---|---|
| Node offline | Syncthing queues; reconciles on reconnect (incl. deletes). Ingester is idempotent (clock-guarded) — replays safe. |
| Curator down | Workers serve their local read-replica (stale but functional); inboxes queue; promotions resume on return. Standby-Curator failover is a noted later enhancement, **not v1**. |
| Corrupt/partial `.md` | Zod-validated; skipped + logged; store never crashes. |
| Clock skew / duplicate topic | Logical-clock LWW + Curator dedup during grading. |
| Overlay full | Syncthing pauses; Monitor node (10) alerts via health checks. |
| Spurious `.sync-conflict` file | Single-writer-per-folder makes these near-impossible; if seen, ingester keeps the higher clock and logs the loser. |

## Testing

- **Unit:** exporter frontmatter + filename; ingester clock-guard (apply `>`,
  skip `≤`); DB→md→DB round-trip idempotent (no echo loop); deletion → removal;
  invalid frontmatter skipped.
- **Integration (no real Syncthing):** two `NoteStore`s + a shared temp dir that
  *stands in for* "the folder Syncthing keeps identical on both sides." Drive
  worker-export → copy dir → curator-ingest+grade+export → copy → worker-ingest;
  assert convergence, LWW, and deletion propagation. Syncthing's contract is just
  "the folder eventually matches," so the bridge is fully testable without the
  daemon.
- **E2E (follow-up, manual):** two real Syncthing instances in Docker sharing a
  folder — validates REST provisioning + live propagation. Out of the core plan.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/memory/notes.ts` *(modify)* | Add the Lamport `rev` column + bump-on-mutation + `max`-merge on ingest (prerequisite) |
| `packages/core/src/memory/replication-frontmatter.ts` | Zod schema + (de)serialize the `.md` frontmatter contract |
| `packages/core/src/memory/notes-export.ts` | Incremental DB→md exporter (clock watermark) |
| `packages/core/src/memory/notes-ingest-watch.ts` | Folder watcher → `markdown-ingest` → `markdown-sync`, clock-guarded |
| `packages/coordination/src/replication/syncthing-config.ts` | REST client: provision devices/folders from the peer-registry |
| `os/base/systemd/coastal-syncthing.service` | Per-node Syncthing daemon unit (shared OS infra) |
| daemon wiring (existing daemon package) | Run worker vs Curator bridge behavior by role |

## Non-goals (YAGNI)

- Not the task board / lossless DB (the A2A `replicator.ts` owns those).
- Not real-time / low-latency (eventually-consistent is fine for knowledge).
- No CRDT body merging (logical-clock LWW + Curator dedup is sufficient).
- No Curator failover in v1 (single authority; standby is a later enhancement).
- No public Syncthing GUI (localhost REST only).

## Required schema change (prerequisite)

`NoteStore` today carries only a **wall-clock `updated_at`** (ms,
`packages/core/src/memory/notes.ts`) — no logical clock. Wall-clock LWW is unsafe
across 12 nodes (clock skew lets a fast node always win). The design therefore
**requires adding a Lamport-style `rev INTEGER` column** to the `notes` table:

- New row → `rev = 1`.
- Local mutation → `rev = rev + 1`.
- Ingest of a peer note → `rev = max(localRev, incomingRev)`; apply the body only
  if `incomingRev > localRev` (tie-break by `origin` as above).

This `rev` is the `clock` in the frontmatter, the exporter watermark, and the
ingester guard. It is additive and back-compatible (`ALTER TABLE notes ADD COLUMN
rev INTEGER NOT NULL DEFAULT 1`); existing single-node behavior is unchanged. This
is the **first task** in the implementation plan.

## Implementation note

- **Grading hook:** wire the Curator's existing grade/prune cycle to consume
  `inbox-<node>/` and emit the keep set to `shared-vault/` (reuse
  `createCuratorDaemon`).
