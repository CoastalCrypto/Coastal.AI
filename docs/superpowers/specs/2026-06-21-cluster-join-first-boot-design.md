# Cluster-Join / First-Boot — Design

> Status: approved 2026-06-21. Next: implementation plan via `writing-plans`.

## Goal

A freshly-booted Coastal.AI OS node reads its own config plus a shared roster and
brings itself **fully online** — identity, trusted peers, Syncthing replication
topology, a role-appropriate coordination daemon, scheduled replication ticks, and
heartbeat emission — with **no runtime enrollment protocol**.

This is the keystone that collapses the "cluster-gated remainder" of both the
Syncthing replication thread and the openobserve Monitor thread down to just the
real-boot wiring + a multi-node convergence test.

## Foundational decisions (locked 2026-06-21)

| Decision | Choice | Why |
|---|---|---|
| Join model | **Static config file** | Deterministic, debuggable, git-trackable, topology-agnostic (1 node or 12; chassis or distributed). Resolves open decision #4. |
| Identity source | **Self-generate on-node, collect public halves** (option B) | Private keys are born on the node and never leave it; only public material (pubkey + Syncthing device-id) is ever distributed. No central single-point-of-compromise; honors the global secret-management rule. |
| Collect/distribute | **Operator-driven script** | No new network service, no enrollment endpoint, no trust window — the operator is the coordination point. Matches "you own the chassis." |
| Role lifecycle | **Fully static** | Role baked at provisioning; change = edit config + restart. Zero election machinery. Failover/election is a later (Phase 4+) resilience add — YAGNI now. Resolves open decision #2. |

## Architecture

One composition root — `bringNodeOnline` — wires together primitives that already
exist and are tested. Almost everything new is pure or injectable, so it is
unit-testable now; only the real boot + multi-node E2E is hardware-gated.

### New modules

All under `packages/coordination/src/cluster/` unless noted.

| Module | Responsibility | Testable now? |
|---|---|---|
| `config.ts` | zod schemas + loaders for node config and roster; validate at the boundary, fail loud | pure |
| `roster.ts` | `assembleRoster(tuples, now)` — fold public tuples into a validated roster (the provisioning brain) | pure |
| `roles.ts` | `role → { replicationRole, taskKinds, model }` mapping | pure |
| `bring-up.ts` | `bringNodeOnline(cfg, roster, deps)` — the composition root | injected deps |
| `identity-public.ts` | `buildPublicTuple(cfg, identity, deviceId)` — pass-1 output | pure |
| `observability/heartbeat.ts` | `emitHeartbeat` / `startHeartbeat` over the existing injected-fetch openobserve client | injected |
| `observability/monitor-loop.ts` | interval → `checkClusterHealth` → notify | injected |

### Reused as-is (no changes)

`identity/keypair.ts` (`loadOrCreateIdentity`), `identity/peer-registry.ts`
(`recordOrVerify` + `setDeviceId` + `knownDeviceIds`), `replication/syncthing-config.ts`
(`reconcileSyncthing`), `replication/syncthing-folders.ts` (`buildWorkerFolders` /
`buildCuratorFolders`), `daemon.ts` (`CoordinationDaemon`),
`core/.../replication-bridge.ts` (`runWorkerTick` / `runCuratorTick`),
`observability/monitor.ts` (`checkClusterHealth`).

### OS-side (specified now, hardware-gated to verify)

- `os/node/scripts/coastal-cluster-provision` — operator-workstation script
  (ssh-collect tuples → `assembleRoster` → push `roster.json`).
- `coastal-os-first-boot` gains an **early** step: generate the Syncthing cert and
  write the public-tuple file (before the long inference-stack build, so collection
  never waits on it).
- `os/base/systemd/coastal-cluster.service` — runs the `@coastal-ai/node-runtime`
  bin (which calls `bringNodeOnline`) after first-boot completes.

## Config schema

Two files, both **JSON** (zero new deps; validates directly with `zod`; matches the
`peer-registry` JSON pattern). **No secrets in either file** — the Syncthing API key
and openobserve token are local per-node secrets pulled from env / local files, never
the git-trackable config.

### `/etc/coastal/node.json` — per-node, baked at provisioning

```typescript
export const NodeRole = z.enum([
  'main', 'coder', 'reviewer', 'tester', 'designer', 'researcher',
  'writer', 'trader', 'curator', 'monitor', 'sandbox', 'voice',
])
export type NodeRole = z.infer<typeof NodeRole>

export const NodeConfig = z.object({
  schema: z.literal('coastal-node-config/v1'),
  nodeId: z.string().min(1),                 // stable id, e.g. "coastal-3a4f"
  role: NodeRole,
  curatorNodeId: z.string().min(1),          // who hosts the authoritative vault
  paths: z.object({
    dataDir:    z.string().min(1),           // /var/lib/coastal
    identity:   z.string().min(1),           // /var/lib/coastal/identity.json (0600)
    sharedVault:z.string().min(1),           // /var/lib/coastal/vault
    inbox:      z.string().min(1),           // worker: its own send-only inbox dir
    inboxBase:  z.string().min(1),           // curator: parent of per-worker inboxes
  }),
  address: z.string().min(1),                // host:port this node listens on (A2A/TCP)
})
export type NodeConfig = z.infer<typeof NodeConfig>
```

### `/etc/coastal/roster.json` — shared, all-public, distributed in pass 2

```typescript
export const RosterEntry = z.object({
  nodeId:   z.string().min(1),
  role:     NodeRole,
  pubkey:   z.string().min(1),   // base64 SPKI-DER (matches keypair.ts AgentIdentity.publicKey)
  deviceId: z.string().min(1),   // Syncthing device id
  address:  z.string().min(1),   // host:port
})

export const Roster = z.object({
  schema: z.literal('coastal-roster/v1'),
  generatedAt: z.number(),       // epoch ms
  nodes: z.array(RosterEntry).min(1),
}).refine(r => new Set(r.nodes.map(n => n.nodeId)).size === r.nodes.length, {
  message: 'roster has duplicate nodeIds',
}).refine(r => r.nodes.filter(n => n.role === 'curator').length === 1, {
  message: 'roster must have exactly one curator',
})
export type Roster = z.infer<typeof Roster>

export const PublicTuple = RosterEntry  // pass-1 output: a roster entry sans assembly
```

### Loaders (fail loud at the boundary)

```typescript
export function loadNodeConfig(path: string): NodeConfig {
  return NodeConfig.parse(JSON.parse(readFileSync(path, 'utf8')))
}
export function loadRoster(path: string): Roster {
  return Roster.parse(JSON.parse(readFileSync(path, 'utf8')))
}
```

The two `refine`s guarantee unique nodeIds and exactly one curator, so the folder
builders always receive a well-formed topology. `bringNodeOnline` additionally
asserts its own `nodeId` appears in the roster (fail loud if a node was provisioned
but never collected).

## Provisioning flow (two-pass, operator-driven)

### Pass 1 — each node emits its public tuple (on first boot)

`coastal-os-first-boot` gains an early step, before the inference-stack build:

```bash
# 1. Ed25519 identity (private key born here, 0600) — via loadOrCreateIdentity
# 2. Syncthing device cert (private key born here too)
syncthing generate --home /var/lib/coastal/syncthing
DEVICE_ID=$(syncthing --home /var/lib/coastal/syncthing --device-id)
# 3. emit the public tuple
coastal-cluster emit-public --device-id "$DEVICE_ID" \
  --out /var/lib/coastal/identity-public.json
```

The emitter is a pure function invoked by that thin CLI:

```typescript
// packages/coordination/src/cluster/identity-public.ts
export function buildPublicTuple(
  cfg: NodeConfig, identity: AgentIdentity, deviceId: string,
): PublicTuple {
  return RosterEntry.parse({
    nodeId: cfg.nodeId, role: cfg.role,
    pubkey: identity.publicKey, deviceId, address: cfg.address,
  })
}
```

### The assembler — provisioning brain (pure, unit-testable)

```typescript
// packages/coordination/src/cluster/roster.ts
export function assembleRoster(tuples: unknown[], now: number): Roster {
  const entries = tuples.map(t => RosterEntry.parse(t))   // validate each
  return Roster.parse({                                   // re-validates invariants
    schema: 'coastal-roster/v1',
    generatedAt: now,
    nodes: [...entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  })
}
```

A missing node or two curators makes `assembleRoster` throw with a clear message
**before anything is distributed** — caught at provisioning time, not at boot.

### Pass 2 — collect, assemble, distribute (operator workstation)

`os/node/scripts/coastal-cluster-provision` — thin bash orchestrator; ssh/scp is the
natural fit, the brain is the tested TS CLI:

```bash
#!/usr/bin/env bash
# Usage: coastal-cluster-provision <hosts-file>   (one ssh target per line)
set -euo pipefail
STAGE=$(mktemp -d)

# Pass 1: collect public tuples (retry — first-boot may still be running)
while read -r host; do
  until scp "$host:/var/lib/coastal/identity-public.json" "$STAGE/$host.json" 2>/dev/null; do
    echo "waiting for $host to emit its tuple…"; sleep 5
  done
done < "$1"

# Assemble (pure TS, validates invariants or aborts)
coastal-cluster assemble "$STAGE" --out "$STAGE/roster.json"

# Pass 2: distribute + bring each node online
while read -r host; do
  scp "$STAGE/roster.json" "$host:/etc/coastal/roster.json"
  ssh "$host" systemctl restart coastal-cluster
done < "$1"
```

### Re-runs (add / replace a node)

Re-running the script is the whole lifecycle. A replaced node self-generates a new
identity + deviceId on its first boot, gets re-collected, and the redistributed
roster + `systemctl restart coastal-cluster` makes every node re-reconcile its peer
set and Syncthing topology. There is no special rekey path — the two-pass flow *is*
the update path.

**Security posture:** everything on the wire here is public (pubkeys, device-ids);
the operator's ssh keys are the trust anchor; no private key or API token ever
transits.

## Bring-up orchestrator + role mapping

### Role metadata — pure data (`roles.ts`)

```typescript
export interface RoleSpec {
  replicationRole: 'curator' | 'worker' | 'observer'
  taskKinds: string[]          // shouldClaim claims tasks whose kind ∈ taskKinds
  model: string | null         // role LLM id (null = no model: sandbox/voice)
}

export const ROLE_SPECS: Record<NodeRole, RoleSpec> = {
  main:      { replicationRole: 'worker',   taskKinds: ['plan_task'],   model: 'llama3.1:13b' },
  coder:     { replicationRole: 'worker',   taskKinds: ['code_task'],   model: 'qwen2.5-coder:7b' },
  reviewer:  { replicationRole: 'worker',   taskKinds: ['review_task'], model: 'deepseek-coder-v2-lite' },
  tester:    { replicationRole: 'worker',   taskKinds: ['test_task'],   model: 'codellama:7b' },
  designer:  { replicationRole: 'worker',   taskKinds: ['design_task'], model: 'llava:7b' },
  researcher:{ replicationRole: 'worker',   taskKinds: ['research_task'],model: 'llama3.1:8b' },
  writer:    { replicationRole: 'worker',   taskKinds: ['write_task'],  model: 'qwen2.5:7b' },
  trader:    { replicationRole: 'worker',   taskKinds: ['trade'],       model: null },
  curator:   { replicationRole: 'curator',  taskKinds: [],              model: 'phi3.5:3.8b' },
  monitor:   { replicationRole: 'observer', taskKinds: [],              model: 'phi3.5:3.8b' },
  sandbox:   { replicationRole: 'worker',   taskKinds: ['exec_task'],   model: null },
  voice:     { replicationRole: 'observer', taskKinds: [],              model: null },
}

export const shouldClaimFor = (spec: RoleSpec) =>
  (task: Task) => spec.taskKinds.includes(task.kind)
```

### The orchestrator (`bring-up.ts`)

Tunable module constants (defaults; the plan pins exact values): `TICK_MS` =
replication tick interval (15_000), `HEARTBEAT_MS` = heartbeat emit interval (10_000),
`MONITOR_MS` = health-check interval (30_000), `STALENESS_MS` = heartbeat staleness
threshold (30_000). `defaultSchedule` wraps `setInterval` with `.unref()` +
per-tick try/catch (a thrown tick logs and the timer survives); `NodeHandle` is
`{ daemon: CoordinationDaemon; stop(): Promise<void> }`; `HttpLike` is the existing
injected-fetch interface `reconcileSyncthing` already takes.

```typescript
export interface BringUpDeps {
  db: Database.Database
  registry: PeerRegistry
  syncthingHttp: HttpLike            // for reconcileSyncthing
  openobserve: OpenObserveClient     // heartbeat + monitor
  noteStore: NoteStore               // replication ticks
  makeTransport: (id: AgentIdentity, roster: Roster, reg: PeerRegistry) => A2ATransport
  workerFor: (role: NodeRole) => DaemonConfig['worker']  // injected — avoids the build cycle
  keep?: (n: Note) => boolean        // curator grader (default: keep all)
  notify: (alerts: Alert[]) => void  // monitor sink
  now?: () => number
  schedule?: (fn: () => void, ms: number) => { stop: () => void }
}

export function bringNodeOnline(cfg: NodeConfig, roster: Roster, deps: BringUpDeps): NodeHandle {
  // 1. identity (private key already on-node, 0600)
  const identity = loadOrCreateIdentity(cfg.nodeId, cfg.paths.identity)

  // 2. assert self is in the roster — fail loud if provisioned-but-uncollected
  const self = roster.nodes.find(n => n.nodeId === cfg.nodeId)
  if (!self) throw new Error(`bringNodeOnline: ${cfg.nodeId} not in roster`)

  // 2b. resolve + validate the curator (explicit — no non-null assertion)
  const curatorNode = roster.nodes.find(n => n.nodeId === cfg.curatorNodeId)
  if (!curatorNode || curatorNode.role !== 'curator') {
    throw new Error(`bringNodeOnline: curatorNodeId '${cfg.curatorNodeId}' does not resolve to a curator`)
  }

  // 3. seed trust from the roster (pre-verified public material)
  const peers = roster.nodes.filter(n => n.nodeId !== cfg.nodeId)
  for (const p of peers) {
    deps.registry.recordOrVerify(p.nodeId, p.pubkey)
    deps.registry.setDeviceId(p.nodeId, p.deviceId)
  }

  // 4. Syncthing topology by replication role
  const spec = ROLE_SPECS[cfg.role]
  const dev = (n: RosterEntry): PeerDevice => ({ nodeId: n.nodeId, deviceId: n.deviceId })
  const workers = roster.nodes.filter(n => ROLE_SPECS[n.role].replicationRole === 'worker')
  const folders =
    spec.replicationRole === 'curator'
      ? buildCuratorFolders(workers.map(dev), { sharedVault: cfg.paths.sharedVault, inboxBase: cfg.paths.inboxBase })
    : spec.replicationRole === 'worker'
      ? buildWorkerFolders(dev(self), dev(curatorNode), { sharedVault: cfg.paths.sharedVault, inbox: cfg.paths.inbox })
      : []   // observer: no folders

  reconcileSyncthing(deps.syncthingHttp, {
    peers: peers.map(dev),
    folders,
    knownDeviceIds: deps.registry.knownDeviceIds(),
  })

  // 5. daemon with role-appropriate worker + claim policy
  const daemon = runCoordinationDaemon({
    identity, transport: deps.makeTransport(identity, roster, deps.registry),
    db: deps.db, tasks: new TaskStore(deps.db), claims: new ClaimStore(deps.db),
    worker: deps.workerFor(cfg.role), shouldClaim: shouldClaimFor(spec),
  })

  // 6. replication ticks by role + 7. heartbeat (all roles) + 8. monitor loop (monitor only)
  const schedule = deps.schedule ?? defaultSchedule
  const timers = [
    spec.replicationRole === 'worker'
      ? schedule(() => runWorkerTick(deps.noteStore, { inbox: cfg.paths.inbox, sharedVault: cfg.paths.sharedVault }, cfg.nodeId), TICK_MS)
    : spec.replicationRole === 'curator'
      ? schedule(() => runCuratorTick(deps.noteStore, { inboxes: workers.map(w => `${cfg.paths.inboxBase}/${w.nodeId}`), sharedVault: cfg.paths.sharedVault }, cfg.nodeId, deps.keep), TICK_MS)
      : null,
    schedule(() => void emitHeartbeat(deps.openobserve, cfg.nodeId, (deps.now ?? Date.now)()), HEARTBEAT_MS),
    cfg.role === 'monitor'
      ? schedule(() => void checkClusterHealth(deps.openobserve, roster.nodes.map(n => n.nodeId), (deps.now ?? Date.now)(), STALENESS_MS).then(deps.notify), MONITOR_MS)
      : null,
  ].filter(Boolean)

  return { daemon, async stop() { for (const t of timers) t!.stop(); await daemon.stop() } }
}
```

### The build-cycle boundary

`coordination` **cannot** import the role-agent packages (`coding-agent`, etc.) —
they depend on `coordination`, and Turbo treats that as a graph edge (this is the
exact cycle that the `swarm-demos` leaf package was created to avoid). So `workerFor`
is **injected**. The only place that imports both is a new leaf entrypoint —
`@coastal-ai/node-runtime` (a thin bin) — which builds the `role → worker` table from
the role-agent packages and calls `bringNodeOnline`. `coastal-cluster.service` runs
that bin.

## Error handling — load-bearing vs. best-effort

Fail loud on anything that breaks correctness; degrade gracefully on observability.

| Failure | Behavior | Rationale |
|---|---|---|
| `node.json` / `roster.json` missing or invalid | zod throws at boundary; `coastal-cluster.service` gates on `ConditionPathExists=/etc/coastal/roster.json` + `Restart=on-failure` | Never boot a half-configured node |
| self `nodeId` not in roster | `throw` | Provisioned-but-uncollected — surface it |
| `curatorNodeId` doesn't resolve to a `curator` roster entry | explicit check + `throw` | Topology would be malformed; catch before `reconcileSyncthing` |
| `reconcileSyncthing` sees an unknown device | throws (existing) | Defense-in-depth; roster-seeded `knownDeviceIds` means it shouldn't fire, but drift is caught |
| Syncthing REST unreachable at boot | fail loud → systemd restarts | Replication is load-bearing |
| openobserve unreachable (heartbeat) | `emitHeartbeat` catches + logs, never throws into the timer | Telemetry loss must not kill the agent |
| a single bad replication tick | wrapped: log + continue, timer survives | One bad note can't stop convergence |

## Testing

### Unit — all codeable now, zero hardware (TDD)

- `config.ts` — valid/invalid configs; both `refine` invariants (dup nodeId, ≠1 curator) reject.
- `roster.ts` — `assembleRoster` folds + sorts; rejects dup/zero/two-curator; validates each tuple.
- `identity-public.ts` — `buildPublicTuple` composes node.json + pubkey + deviceId correctly.
- `roles.ts` — every `NodeRole` has a spec; `shouldClaimFor` matches kinds.
- **`bring-up.ts` (keystone)** — inject fakes (recording `syncthingHttp`, fake
  `registry`, fake `schedule` capturing fns + intervals, fake `openobserve` /
  `makeTransport` / `workerFor`) and assert: registry seeded with N−1 peers;
  `reconcileSyncthing` got the right folders for curator vs worker vs observer; daemon
  built with the role's `shouldClaim`; worker→worker-tick, curator→curator-tick
  (correct inbox paths), observer→neither; heartbeat scheduled for all roles;
  monitor-loop only for `monitor`; both throw-paths fire; `stop()` tears everything down.
- `heartbeat.ts` — ingests correct JSON to the `heartbeats` stream; swallows fetch errors.
- `monitor-loop.ts` — `checkClusterHealth → notify` happy + alert paths.

### Integration — specified now, hardware/runtime-gated

- **2-container E2E** (`docker-compose`): curator + worker containers with real
  Syncthing + openobserve; run `coastal-cluster-provision` against them; assert a note
  authored on the worker converges to the curator vault and back, and both nodes show
  healthy heartbeats. (This is the long-standing "manual 2-container E2E" item, now
  with a concrete harness.)
- **Real first-boot** on a BC-250: provisioning collects tuples → distributes roster →
  nodes come online.

## What this spec unblocks

| Codeable + unit-tested now (TDD) | Hardware / runtime-gated (deferred) |
|---|---|
| `config`, `roster`, `identity-public`, `roles`, `bring-up`, `heartbeat`, `monitor-loop`, the `node-runtime` worker table | `coastal-os-first-boot` syncthing-generate step; `coastal-cluster-provision` run against real hosts; `coastal-cluster.service` on real boot; 2-container + BC-250 E2E |

Implementing this design lands ~7 fully-tested modules that collapse the entire
"cluster-gated remainder" for *both* the Syncthing and openobserve threads down to
just the real-boot wiring + the multi-node convergence test.
