# openobserve Monitor Backend — Design

> **Status:** approved-by-direction 2026-06-19 ("work the list using your
> recommendations"). Implements HANDOFF #5 "openobserve as the Monitor/Watchdog
> agent backend." Scope is the **testable library slice**; live cluster wiring is
> deferred (hardware-gated), mirroring the Syncthing replication approach.

## Goal

Give the multi-agent OS Monitor/Watchdog role (node 10) a backend to store and
query cluster telemetry, so it can detect unhealthy/stale nodes and raise alerts.
openobserve (self-hosted logs/metrics/traces, single Go binary, HTTP+SQL API) is
the sink; this feature ships a typed client + the health-evaluation logic + a
systemd unit. Zombie reclaim already exists (`coordination/transitions/reclaim.ts`)
and is out of scope.

## Scope

**In (buildable + testable now):**
- A typed **openobserve client** with `ingest(stream, events)` and `query(sql)`,
  HTTP injected for testability.
- A pure **health-evaluation** function: heartbeats + threshold → alerts.
- A **systemd unit** for running openobserve on a node.

**Out (cluster-gated, tracked as follow-ups):**
- Per-node heartbeat emission into openobserve.
- The Monitor agent's periodic query→alert loop wired into its daemon.
- Provisioning the openobserve binary into the OS image (it is not an apt
  package; install fetches the release binary).

## Components

### `packages/coordination/src/observability/openobserve-client.ts`
Injected-`fetch` client (same pattern as `syncthing-config.ts`):

```ts
export type FetchLike = (url: string, init: { method: string; headers: Record<string,string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface OpenObserveConfig {
  baseUrl: string         // e.g. http://node-10:5080
  org: string             // e.g. 'coastal'
  auth: string            // basic-auth header value, "Basic base64(user:pass)"
  fetchImpl: FetchLike
}

ingest(stream: string, events: Record<string, unknown>[]): Promise<{ ingested: number }>
//  POST {baseUrl}/api/{org}/{stream}/_json   body = JSON array

query(sql: string): Promise<Record<string, unknown>[]>
//  POST {baseUrl}/api/{org}/_search          body = { query: { sql, start_time, end_time } }
```

Errors: a non-`ok` response throws with status + body excerpt (validate at the
boundary; never silently swallow).

### `packages/coordination/src/observability/health-eval.ts`
Pure, no I/O:

```ts
export interface Heartbeat { nodeId: string; role: string; ts: number; ok: boolean }
export interface Alert { nodeId: string; role: string; severity: 'warn' | 'critical'; reason: string }

/**
 * Given the latest heartbeat per node, `now`, and a staleness threshold (ms),
 * return alerts: nodes with no heartbeat within the threshold are 'critical'
 * (stale), nodes whose latest heartbeat has ok=false are 'warn'. Expected nodes
 * absent entirely are 'critical' (never seen / down).
 */
export function evaluateHealth(
  latest: Heartbeat[],
  expectedNodeIds: string[],
  now: number,
  stalenessMs: number,
): Alert[]
```

### `os/base/systemd/coastal-openobserve.service`
Runs the openobserve binary bound to localhost+LAN as configured; data on the
writable overlay. Installed but not enabled by default (the Monitor node enables
it during cluster bring-up).

## Data flow (target, once wired)

```
each node ──heartbeat (ingest 'heartbeats' stream)──▶ openobserve (node 10)
Monitor agent ──query latest heartbeats──▶ evaluateHealth() ──▶ Alert[] ──▶ notify
```

## Testing

- **Client (unit):** mock `FetchLike`; assert `ingest` POSTs to the right URL with
  the JSON array body and returns the count; `query` POSTs SQL and maps `hits`;
  a non-ok response throws.
- **health-eval (unit):** fresh ok heartbeat → no alert; stale → critical; ok=false
  → warn; expected-but-absent node → critical.

## Non-goals (YAGNI)

- No traces/metrics OTLP pipeline (heartbeats + simple events suffice for v1).
- No openobserve clustering/HA (single instance on the Monitor node).
- No reclaim logic (already in coordination).
- No binary provisioning here (cluster bring-up concern).

## File structure

| File | Responsibility |
|---|---|
| `packages/coordination/src/observability/openobserve-client.ts` | ingest + query over injected fetch |
| `packages/coordination/src/observability/health-eval.ts` | pure heartbeats→alerts |
| `packages/coordination/src/observability/__tests__/*.test.ts` | unit tests for both |
| `os/base/systemd/coastal-openobserve.service` | run the openobserve binary |

## Follow-ups (cluster-gated)

- Emit per-node heartbeats from the daemon into the `heartbeats` stream.
- Monitor daemon loop: `query` latest heartbeats → `evaluateHealth` → notify
  (Telegram/Discord via existing channels).
- Fetch the openobserve binary in the node-image build (or first-boot).
