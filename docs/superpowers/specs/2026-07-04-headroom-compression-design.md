# Headroom Token Compression — Design

> Status: approved 2026-07-04. Next: implementation plan via `writing-plans`.

## Goal

Cut LLM token consumption across all 12 role agents on the cluster by compressing the
compressible parts of each request's `messages[]` in‑process, transparently, before the
call reaches the model — with no new process on any BC‑250 node and no change to the
agents themselves.

## Why

`headroom-ai` (Apache‑2.0) does deterministic, no‑extra‑LLM‑call compression of structured
bulk (JSON tool outputs, code, logs) with accuracy preserved on benchmarks.

**Corrected 2026‑07‑04 (verified against the installed package):** the npm TS SDK
(`headroom-ai` v0.22.4) is a **thin client to the headroom service**, not a local
compressor. `compress(messages, options)` POSTs to a headroom proxy (`baseUrl`, default
`http://127.0.0.1:8787`) or cloud (`apiKey`); the "zero dependencies" simply means it uses
global `fetch`. The actual SmartCrusher/ML compression runs in the proxy. Therefore the
in‑process decorator is the **integration point**, but real compression requires a
**per‑node headroom proxy sidecar** (systemd, provisioned into the image — same pattern as
syncthing/openobserve; local‑only, no cloud, no context leaves the node). `fallback: true`
makes `compress` degrade to a passthrough when the proxy is unreachable, so the decorator is
a safe no‑op until the proxy is deployed. Telemetry comes from `CompressResult`
(`tokensBefore/After/Saved`). See `project_repo_eval_2026_07`.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Integration point | **In‑process TS decorator on `LlmClient`** | Fits the existing dependency‑injection; unit‑testable; agents stay unaware |
| Compression backend | **Per‑node headroom proxy sidecar** (decorator is the client) | `headroom-ai` TS SDK is a client, not local compute; the proxy runs on‑node (local‑only, no cloud); same systemd pattern as syncthing/openobserve |
| Reversibility | **One‑way (no CCR)** | Small local models (phi3.5, qwen‑7b) can't reliably drive a retrieve tool; one‑way can't wedge |
| Rollout | **Default‑on for all roles, per‑role disable** | Broadest immediate benefit; off‑switch if a role regresses |
| Failure posture | **Fail‑open, never regress** | A bad/failed compression is silently a no‑op on the original |

## Architecture

One decorator implementing the existing `LlmClient` interface, wired at the composition
root (the node‑runtime that builds each role agent — the same acyclic boundary used by
cluster‑join). Agents are unaware; the OS decides who gets wrapped.

### New unit — `packages/llm-client/src/compressing-client.ts`

```ts
export interface CompressOutcome {
  messages: ChatMessage[]      // compressed (same shape/order/count as input)
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  compressed: boolean
}
export type CompressFn = (messages: ChatMessage[], opts: { model: string }) => Promise<CompressOutcome>
// default: wraps headroom-ai `compress` (POST 127.0.0.1:8787, fallback:true) → maps CompressResult

export interface CompressionStat {
  model: string
  messagesCompressed: number
  tokensBefore: number   // summed from CompressResult
  tokensAfter: number
  tokensSaved: number
}

export interface CompressOpts {
  compress?: CompressFn                    // default: headroom-ai `compress` (baseUrl 127.0.0.1:8787, fallback:true)
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
`onStats`→openobserve) + the `compression` config block + the **per‑node headroom proxy
systemd unit** (`os/base/systemd/coastal-headroom.service`, provisioned into the image —
hardware/operator‑gated, like coastal‑syncthing/coastal‑openobserve).

**Out (v1):** the ML text‑compressor (Python‑only), CCR/reversible retrieval, output‑token
compression, a per‑node proxy, output‑side A/B holdout measurement.
