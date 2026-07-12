# Note Recall (FTS5) — Design

> Status: approved 2026-07-06. Building directly (plan skipped per operator).

## Goal

Give worker agents the ability to pull the most relevant notes into their LLM context
using the existing FTS5 `NoteStore.search`, so the coder/planner/researcher reason with the
swarm's accumulated memory. Zero new infrastructure, pure TypeScript. This builds the
missing **recall consumer**; cognee (graph‑RAG) stays deferred as a later, evidence‑driven
upgrade only if FTS5 recall proves insufficient (see `project_repo_eval_2026_07`).

## Context

Today nothing recalls notes into an agent's context: `NoteStore.search` (FTS5 `MATCH ?
ORDER BY rank`, BM25) is consumed only by the human‑facing `/notes` and `/search` API
routes; the Curator only grades/prunes/consolidates. `NoteStore.search` does **not** catch
FTS5 syntax errors, so a raw task string could throw — recall must sanitize and fail safe.

## Locked decisions

| Decision | Choice |
|---|---|
| Backend | Existing FTS5 `NoteStore.search` (BM25) — no new infra |
| Boundary | Per‑agent **opt‑in helper** (the worker owns its prompt), not a transparent decorator — recall needs the task/query intent |
| Injection | A `user`‑role context message (compressible — pairs with the headroom decorator), never `system` |
| First consumer | coding‑agent (reference wiring); others adopt the one‑liner later (YAGNI) |
| Failure | Fail‑safe — any recall error → no injection, agent proceeds unchanged |

## Architecture

Two pure units in `@coastal-ai/core` (`memory/recall.ts`), plus reference wiring in the
coding‑agent. Core must **not** depend on `@coastal-ai/llm-client`, so `recallContextMessage`
returns a structural `{ role: 'user'; content: string }` (assignable to `ChatMessage`) rather
than importing the type.

```ts
// packages/core/src/memory/recall.ts
export interface RecallOpts { limit?: number; maxChars?: number; snippetChars?: number }

export function buildFtsQuery(text: string): string          // exported for testing
export function recallNotes(store: NoteStore, queryText: string, opts?: RecallOpts): Note[]
export function formatRecalledNotes(notes: Note[], snippetChars?: number): string
export function recallContextMessage(store: NoteStore, queryText: string, opts?: RecallOpts): { role: 'user'; content: string } | null
```

New core export subpath: `./memory/recall`.

### Data flow (coding‑agent)

```
coderWorker(task):
  if config.recall:
    msg = recallContextMessage(config.recall.store, payload.request, { limit, maxChars })
    messages = [system, ...(msg ? [msg] : []), userRequest]
  else:
    messages = [system, userRequest]        // unchanged when recall not configured
  → client.chat({ model, messages, ... })
```

## Recall policy

- **Query derivation + FTS5 safety.** Callers pass raw task text; `recallNotes` builds the
  FTS query itself via `buildFtsQuery`: tokenize `[a-z0-9]+`, lowercase, drop `<3`‑char
  tokens and basic stopwords, dedupe, take up to **8** terms, join with **` OR `** (broad
  BM25 recall). No terms → return `[]` (no injection). This guarantees no caller triggers an
  FTS5 syntax error.
- **Ranking + limit.** `store.search(q, limit)` is already BM25‑ranked; default `limit` **5**.
- **Budget.** Greedy by rank: include whole notes until the next would exceed `maxChars`
  (default **2000**); skip overflow rather than truncating mid‑note.
- **Formatting.** Deterministic block:
  ```
  ## Relevant memory
  - [kind] Title: first ~snippetChars (default 300) chars of body, newlines collapsed…
  ```
  No scores/ids.
- **Injection.** `recallContextMessage` returns `{ role: 'user', content: block }` — `user`
  so the headroom compression decorator compresses it; the two features compound.

## Error handling (recall never load‑bearing)

| Condition | Behavior |
|---|---|
| `store.search` throws | `recallNotes` catches → returns `[]` |
| empty query / no matches / all over budget | `recallContextMessage` → `null`; agent injects nothing |
| store mutation | none — recall is read‑only |
| coder wiring | recall `null` → messages built exactly as today (fail‑open) |

## Testing (pure unit, in‑memory NoteStore, no LLM/network)

- `buildFtsQuery`: strips FTS5 operators/quotes; drops stopwords/short tokens; caps at 8; empty on stopword‑only.
- `recallNotes`: BM25 top‑`limit`; `maxChars` drops lowest‑ranked overflow; a query with FTS5 operators (`"foo" OR (bar*)`) does not throw and returns results; empty query → `[]`; **`store.search` throws → `[]`**.
- `formatRecalledNotes`: deterministic block; snippet capped; kind+title present; newlines collapsed.
- `recallContextMessage`: `{ role: 'user', … }` with the block; `null` when no notes.
- **coder wiring:** fake store returns notes → the coder's outgoing messages include the recall block as a `user` message ahead of the instruction; empty store → no extra message; recall throws → coder still produces its normal request.

## Scope

**In:** `recall.ts` (3 exports + `buildFtsQuery`), the `./memory/recall` export subpath, and the coding‑agent reference wiring (opt‑in `recall` config).

**Out:** cognee / graph‑RAG (deferred); wiring recall into planner/reviewing/researcher (later, same one‑liner); a dedicated recall API route; relevance tuning beyond BM25.
