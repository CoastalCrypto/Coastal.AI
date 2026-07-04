# Headroom Token Compression — Design

> Status: approved 2026-07-04. Next: implementation plan via `writing-plans`.

## Goal

Cut LLM token consumption across all 12 role agents on the cluster by compressing the
compressible parts of each request's `messages[]` in‑process, transparently, before the
call reaches the model — with no new process on any BC‑250 node and no change to the
agents themselves.

## Why

`headroom-ai` (Apache‑2.0) does deterministic, local, no‑extra‑LLM‑call compression of
structured bulk (JSON tool outputs, code, logs) with accuracy preserved on benchmarks.
Its npm TS SDK (v0.22.4) has **zero runtime dependencies** (only optional peer‑adapters
for openai/anthropic/ai‑sdk) — it compresses locally, in‑process, pure JS, no ONNX/native
bindings. That makes it a drop‑in token/cost lever for every agent that talks to a model,
riding entirely on infrastructure that already exists (the injectable `LlmClient`, the
node‑runtime composition root, the openobserve client). See
`project_repo_eval_2026_07` for the adoption rationale.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Integration point | **In‑process TS decorator on `LlmClient`** | Fits the existing dependency‑injection; no per‑node Python proxy; unit‑testable; agents stay unaware |
| Compressor | **headroom‑ai deterministic (TS, local)** | Zero‑dep, no ONNX; the ML text‑compressor is Python‑only → deferred |
| Reversibility | **One‑way (no CCR)** | Small local models (phi3.5, qwen‑7b) can't reliably drive a retrieve tool; one‑way can't wedge |
| Rollout | **Default‑on for all roles, per‑role disable** | Broadest immediate benefit; off‑switch if a role regresses |
| Failure posture | **Fail‑open, never regress** | A bad/failed compression is silently a no‑op on the original |

## Architecture

One decorator implementing the existing `LlmClient` interface, wired at the composition
root (the node‑runtime that builds each role agent — the same acyclic boundary used by
cluster‑join). Agents are unaware; the OS decides who gets wrapped.

### New unit — `packages/llm-client/src/compressing-client.ts`

```ts
export type CompressFn = (messages: ChatMessage[], opts: { model: string }) => Promise<ChatMessage[]> | ChatMessage[]

export interface CompressionStat {
  model: string
  messagesCompressed: number
  beforeChars: number
  afterChars: number
}

export interface CompressOpts {
  compress?: CompressFn                    // default: headroom-ai `compress`
  minChars?: number                        // default 500 — below this, pass through
  onStats?: (s: CompressionStat) => void   // default no-op
}

export function createCompressingLlmClient(inner: LlmClient, opts?: CompressOpts): LlmClient
```

- `chat(req)`: compress `req.messages` → `inner.chat({ ...req, messages })`.
- `chatStream(req)`: same input compression, delegate streaming unchanged.
- `compress` and `onStats` are injected (default `compress` = `headroom-ai`) so tests use
  fakes and `headroom-ai` is the package's only new dependency.

### Data flow

```
role agent → (injected) LlmClient.chat(req)
   └─ createCompressingLlmClient decorator:
        for each message:
          if role==='system' OR content.length < minChars → keep verbatim
          else → candidate = compress([message], {model})
                 use candidate only if it is SMALLER than the original, else keep original
        emit CompressionStat via onStats (best-effort)
        → inner.chat({ ...req, messages: compressed })   ← the real OpenAI-compatible call
   ← ChatResponse passes straight back (finishReason/usage/modelUsed unchanged)
```

## Compression policy

- **Content‑aware, self‑targeting.** headroom crushes JSON/code/logs and leaves short prose
  alone; "compress the messages" is inherently targeted.
- **Compress:** `user`/`assistant` messages carrying bulk context (tool outputs, retrieved
  notes/RAG, code, prior‑turn dumps).
- **Protect (verbatim):** the `system` prompt (role definitions + output‑format contracts
  like the reviewing‑agent's `VERDICT/ISSUES` schema) and any message below `minChars`.
- **One‑way:** no retrieve tool, no originals cache. CCR is a documented future option for a
  node running a tool‑capable model.
- **Determinism preserved:** compression adds no LLM call and is deterministic.

## Config & measurement

- **Per‑role enable at the composition root**, not the decorator. The node‑runtime reads:
  ```ts
  compression: { enabled: boolean /*default true*/; disabledRoles: NodeRole[] /*default []*/ }
  ```
  and decides whether to WRAP each role's client. The decorator stays pure ("always
  compresses input"); the OS decides who gets it.
- **Measurement → openobserve** (reuse cluster‑join infra). The node‑runtime wires `onStats`
  to ingest a `compression` stream row (`{nodeId, role, model, beforeChars, afterChars, ts}`)
  via the existing openobserve client, wrapped exactly like `emitHeartbeat` (telemetry
  failure never touches the agent call). Measure **chars** (deterministic pre‑call proxy,
  ~chars/4 ≈ tokens); no output‑side A/B holdout — v1 is input‑only.

## Error handling (all fail‑open)

| Condition | Behavior |
|---|---|
| `compress` throws | Use the ORIGINAL messages; log a warn; call proceeds |
| "compressed" ≥ original (per message) | Keep the original message |
| `onStats` throws | Swallowed (telemetry must not touch the agent path) |
| `system` role / `< minChars` | Passed through verbatim |
| `ChatResponse` | Passes straight through — the decorator only rewrites *input* messages |
| `chatStream` | Compresses input identically, streams through unchanged |

## Testing

**Pure unit (no LLM/network):** fake `inner: LlmClient` records received `messages[]`; fake
`compress` returns a marker.
- system message untouched
- short (`< minChars`) message untouched
- large `user` message replaced by the compressed form the inner client receives
- `onStats` fired with correct `beforeChars/afterChars/messagesCompressed`
- **`compress` throws → inner receives the ORIGINAL messages** (fail‑open)
- compressed‑larger → original kept
- `chatStream` compresses input and streams through unchanged

**One real‑`headroom-ai` integration test:** feed a real JSON tool‑output blob through the
default `compress` and assert the result is materially smaller and still structurally
faithful — proves the dep works in‑process with zero infra.

## Scope

**In:** the decorator unit + `headroom-ai` dep + the node‑runtime wiring (wrap‑by‑role +
`onStats`→openobserve) + the `compression` config block.

**Out (v1):** the ML text‑compressor (Python‑only), CCR/reversible retrieval, output‑token
compression, a per‑node proxy, output‑side A/B holdout measurement.
