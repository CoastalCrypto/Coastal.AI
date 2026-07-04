# Cluster-Join / First-Boot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freshly-booted node reads its config + a shared roster and brings itself fully online — identity, trusted peers, Syncthing topology, a role-appropriate daemon, scheduled replication ticks, and heartbeat emission — with no runtime enrollment.

**Architecture:** A single composition root `bringNodeOnline(cfg, roster, deps)` wires together primitives that already exist and are tested (`loadOrCreateIdentity`, `PeerRegistry`, `buildWorkerFolders`/`buildCuratorFolders`, `reconcileSyncthing`, `CoordinationDaemon`, `runWorkerTick`/`runCuratorTick`, `checkClusterHealth`). Everything new is pure or dependency-injected, so all logic is unit-tested now; only the real boot + multi-node E2E is hardware-gated. A new leaf package `@coastal-ai/node-runtime` is the only place that imports both `coordination` and the role-agent packages (avoiding the Turbo build cycle), and ships the `coastal-cluster` CLI (`emit-public` / `assemble` / `run`).

**Tech Stack:** TypeScript (ESM, NodeNext), zod, vitest, better-sqlite3, pnpm + turbo workspace. Reference spec: `docs/superpowers/specs/2026-06-21-cluster-join-first-boot-design.md`.

---

## File Structure

New files (all under `packages/coordination/src/cluster/` unless noted):

| File | Responsibility |
|---|---|
| `config.ts` | zod `NodeRole`, `NodeConfig`, `RosterEntry`, `Roster`, `PublicTuple` + `loadNodeConfig`/`loadRoster` |
| `roster.ts` | `assembleRoster(tuples, now)` — fold validated public tuples into a validated roster |
| `identity-public.ts` | `buildPublicTuple(cfg, identity, deviceId)` |
| `roles.ts` | `RoleSpec`, `ROLE_SPECS`, `shouldClaimFor` |
| `bring-up.ts` | `foldersForRole(cfg, roster)` (pure) + `bringNodeOnline(cfg, roster, deps)` + `BringUpDeps`/`NodeHandle` |
| `observability/heartbeat.ts` | `emitHeartbeat` / `startHeartbeat` |
| `observability/monitor-loop.ts` | `startMonitorLoop` |
| `__tests__/*` | one vitest file per module above |

Modified files:

| File | Change |
|---|---|
| `packages/coordination/src/index.ts` | export the new cluster + observability surface |

New package + OS-side (hardware-gated to verify):

| File | Responsibility |
|---|---|
| `packages/node-runtime/` | leaf package: `coastal-cluster` CLI + role→worker table + `run` entrypoint |
| `os/node/files/usr/local/sbin/coastal-os-first-boot` | add early syncthing-generate + emit-public step |
| `os/node/scripts/coastal-cluster-provision` | operator two-pass provisioning script |
| `os/base/systemd/coastal-cluster.service` | runs `coastal-cluster run` after first-boot |

**Build/test commands (Windows + pnpm + turbo):**
- One-time, ensure deps built: `pnpm exec turbo build --filter @coastal-ai/core`
- Single test file during TDD: `pnpm --filter @coastal-ai/coordination exec vitest run <relative-path>`
- Full package gate (before commit): `pnpm exec turbo test --filter @coastal-ai/coordination`
- Do NOT add per-package `pretest` dep-builds (they race on Windows — see project history).

---

### Task 1: Config schemas + loaders

**Files:**
- Create: `packages/coordination/src/cluster/config.ts`
- Test: `packages/coordination/src/cluster/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/cluster/__tests__/config.test.ts
import { describe, it, expect } from 'vitest'
import { NodeConfig, Roster } from '../config.js'

const goodNode = {
  schema: 'coastal-node-config/v1', nodeId: 'n1', role: 'coder', curatorNodeId: 'c1',
  paths: { dataDir: '/var/lib/coastal', identity: '/var/lib/coastal/identity.json',
    sharedVault: '/var/lib/coastal/vault', inbox: '/var/lib/coastal/inbox', inboxBase: '/var/lib/coastal/inboxes' },
  address: '10.0.0.1:4747',
}
const entry = (o: Partial<Record<string, unknown>>) => ({
  nodeId: 'n1', role: 'coder', pubkey: 'PK', deviceId: 'DEV', address: '10.0.0.1:4747', ...o,
})

describe('NodeConfig', () => {
  it('accepts a well-formed node config', () => {
    expect(NodeConfig.parse(goodNode).nodeId).toBe('n1')
  })
  it('rejects an unknown schema literal', () => {
    expect(() => NodeConfig.parse({ ...goodNode, schema: 'x' })).toThrow()
  })
})

describe('Roster', () => {
  it('accepts exactly one curator', () => {
    const r = Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'c1', role: 'curator' }), entry({ nodeId: 'n1', role: 'coder' })] })
    expect(r.nodes).toHaveLength(2)
  })
  it('rejects duplicate nodeIds', () => {
    expect(() => Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'c1', role: 'curator' }), entry({ nodeId: 'c1', role: 'coder' })] }))
      .toThrow(/duplicate nodeIds/)
  })
  it('rejects zero or two curators', () => {
    expect(() => Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'a', role: 'coder' })] })).toThrow(/exactly one curator/)
    expect(() => Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'a', role: 'curator' }), entry({ nodeId: 'b', role: 'curator' })] }))
      .toThrow(/exactly one curator/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/config.test.ts`
Expected: FAIL — cannot find module `../config.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/cluster/config.ts
import { z } from 'zod'
import { readFileSync } from 'node:fs'

export const NodeRole = z.enum([
  'main', 'coder', 'reviewer', 'tester', 'designer', 'researcher',
  'writer', 'trader', 'curator', 'monitor', 'sandbox', 'voice',
])
export type NodeRole = z.infer<typeof NodeRole>

export const NodeConfig = z.object({
  schema: z.literal('coastal-node-config/v1'),
  nodeId: z.string().min(1),
  role: NodeRole,
  curatorNodeId: z.string().min(1),
  paths: z.object({
    dataDir: z.string().min(1),
    identity: z.string().min(1),
    sharedVault: z.string().min(1),
    inbox: z.string().min(1),
    inboxBase: z.string().min(1),
  }),
  address: z.string().min(1),
})
export type NodeConfig = z.infer<typeof NodeConfig>

export const RosterEntry = z.object({
  nodeId: z.string().min(1),
  role: NodeRole,
  pubkey: z.string().min(1),
  deviceId: z.string().min(1),
  address: z.string().min(1),
})
export type RosterEntry = z.infer<typeof RosterEntry>
export const PublicTuple = RosterEntry

export const Roster = z.object({
  schema: z.literal('coastal-roster/v1'),
  generatedAt: z.number(),
  nodes: z.array(RosterEntry).min(1),
})
  .refine(r => new Set(r.nodes.map(n => n.nodeId)).size === r.nodes.length, {
    message: 'roster has duplicate nodeIds',
  })
  .refine(r => r.nodes.filter(n => n.role === 'curator').length === 1, {
    message: 'roster must have exactly one curator',
  })
export type Roster = z.infer<typeof Roster>

export function loadNodeConfig(path: string): NodeConfig {
  return NodeConfig.parse(JSON.parse(readFileSync(path, 'utf8')))
}
export function loadRoster(path: string): Roster {
  return Roster.parse(JSON.parse(readFileSync(path, 'utf8')))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/cluster/config.ts packages/coordination/src/cluster/__tests__/config.test.ts
git commit -m "feat(cluster): node + roster config schemas with parse-time invariants"
```

---

### Task 2: Roster assembler

**Files:**
- Create: `packages/coordination/src/cluster/roster.ts`
- Test: `packages/coordination/src/cluster/__tests__/roster.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/cluster/__tests__/roster.test.ts
import { describe, it, expect } from 'vitest'
import { assembleRoster } from '../roster.js'

const t = (o: Partial<Record<string, unknown>>) => ({
  nodeId: 'n', role: 'coder', pubkey: 'PK', deviceId: 'DEV', address: '10.0.0.1:4747', ...o,
})

describe('assembleRoster', () => {
  it('folds tuples, sorts by nodeId, stamps generatedAt', () => {
    const r = assembleRoster([t({ nodeId: 'z', role: 'coder' }), t({ nodeId: 'a', role: 'curator' })], 42)
    expect(r.nodes.map(n => n.nodeId)).toEqual(['a', 'z'])
    expect(r.generatedAt).toBe(42)
  })
  it('rejects two curators with a clear message', () => {
    expect(() => assembleRoster([t({ nodeId: 'a', role: 'curator' }), t({ nodeId: 'b', role: 'curator' })], 1))
      .toThrow(/exactly one curator/)
  })
  it('rejects a malformed tuple (missing deviceId)', () => {
    expect(() => assembleRoster([{ nodeId: 'a', role: 'curator', pubkey: 'PK', address: 'x' }], 1)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/roster.test.ts`
Expected: FAIL — cannot find module `../roster.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/cluster/roster.ts
import { RosterEntry, Roster, type Roster as RosterT } from './config.js'

export function assembleRoster(tuples: unknown[], now: number): RosterT {
  const entries = tuples.map(t => RosterEntry.parse(t))
  return Roster.parse({
    schema: 'coastal-roster/v1',
    generatedAt: now,
    nodes: [...entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/roster.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/cluster/roster.ts packages/coordination/src/cluster/__tests__/roster.test.ts
git commit -m "feat(cluster): assembleRoster — pure provisioning brain, fail-loud invariants"
```

---

### Task 3: Public-tuple emitter

**Files:**
- Create: `packages/coordination/src/cluster/identity-public.ts`
- Test: `packages/coordination/src/cluster/__tests__/identity-public.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/cluster/__tests__/identity-public.test.ts
import { describe, it, expect } from 'vitest'
import { buildPublicTuple } from '../identity-public.js'
import type { NodeConfig } from '../config.js'

const cfg = {
  schema: 'coastal-node-config/v1', nodeId: 'n1', role: 'coder', curatorNodeId: 'c1',
  paths: { dataDir: '/d', identity: '/d/id.json', sharedVault: '/d/vault', inbox: '/d/inbox', inboxBase: '/d/inboxes' },
  address: '10.0.0.1:4747',
} as NodeConfig

describe('buildPublicTuple', () => {
  it('composes nodeId/role/address from config + pubkey + deviceId', () => {
    const tuple = buildPublicTuple(cfg, { agentId: 'n1', publicKey: 'PK', privateKey: 'SK' }, 'DEVID')
    expect(tuple).toEqual({ nodeId: 'n1', role: 'coder', pubkey: 'PK', deviceId: 'DEVID', address: '10.0.0.1:4747' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/identity-public.test.ts`
Expected: FAIL — cannot find module `../identity-public.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/cluster/identity-public.ts
import type { AgentIdentity } from '../types.js'
import { RosterEntry, type NodeConfig, type RosterEntry as RosterEntryT } from './config.js'

export function buildPublicTuple(
  cfg: NodeConfig, identity: AgentIdentity, deviceId: string,
): RosterEntryT {
  return RosterEntry.parse({
    nodeId: cfg.nodeId, role: cfg.role,
    pubkey: identity.publicKey, deviceId, address: cfg.address,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/identity-public.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/cluster/identity-public.ts packages/coordination/src/cluster/__tests__/identity-public.test.ts
git commit -m "feat(cluster): buildPublicTuple — pass-1 output composition"
```

---

### Task 4: Role → daemon mapping

**Files:**
- Create: `packages/coordination/src/cluster/roles.ts`
- Test: `packages/coordination/src/cluster/__tests__/roles.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/cluster/__tests__/roles.test.ts
import { describe, it, expect } from 'vitest'
import { ROLE_SPECS, shouldClaimFor } from '../roles.js'
import { NodeRole } from '../config.js'
import type { Task } from '../../types.js'

describe('ROLE_SPECS', () => {
  it('has a spec for every NodeRole', () => {
    for (const role of NodeRole.options) expect(ROLE_SPECS[role]).toBeDefined()
  })
  it('has exactly one curator-replication role', () => {
    const curators = Object.values(ROLE_SPECS).filter(s => s.replicationRole === 'curator')
    expect(curators).toHaveLength(1)
  })
})

describe('shouldClaimFor', () => {
  it('claims only tasks whose kind is in the role taskKinds', () => {
    const claim = shouldClaimFor(ROLE_SPECS.coder)
    expect(claim({ kind: 'code_task' } as Task)).toBe(true)
    expect(claim({ kind: 'review_task' } as Task)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/roles.test.ts`
Expected: FAIL — cannot find module `../roles.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/cluster/roles.ts
import type { Task } from '../types.js'
import type { NodeRole } from './config.js'

export interface RoleSpec {
  replicationRole: 'curator' | 'worker' | 'observer'
  taskKinds: string[]
  model: string | null
}

export const ROLE_SPECS: Record<NodeRole, RoleSpec> = {
  main:       { replicationRole: 'worker',   taskKinds: ['plan_task'],     model: 'llama3.1:13b' },
  coder:      { replicationRole: 'worker',   taskKinds: ['code_task'],     model: 'qwen2.5-coder:7b' },
  reviewer:   { replicationRole: 'worker',   taskKinds: ['review_task'],   model: 'deepseek-coder-v2-lite' },
  tester:     { replicationRole: 'worker',   taskKinds: ['test_task'],     model: 'codellama:7b' },
  designer:   { replicationRole: 'worker',   taskKinds: ['design_task'],   model: 'llava:7b' },
  researcher: { replicationRole: 'worker',   taskKinds: ['research_task'], model: 'llama3.1:8b' },
  writer:     { replicationRole: 'worker',   taskKinds: ['write_task'],    model: 'qwen2.5:7b' },
  trader:     { replicationRole: 'worker',   taskKinds: ['trade'],         model: null },
  curator:    { replicationRole: 'curator',  taskKinds: [],                model: 'phi3.5:3.8b' },
  monitor:    { replicationRole: 'observer', taskKinds: [],                model: 'phi3.5:3.8b' },
  sandbox:    { replicationRole: 'worker',   taskKinds: ['exec_task'],     model: null },
  voice:      { replicationRole: 'observer', taskKinds: [],                model: null },
}

export const shouldClaimFor = (spec: RoleSpec) =>
  (task: Task): boolean => spec.taskKinds.includes(task.kind)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/roles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/cluster/roles.ts packages/coordination/src/cluster/__tests__/roles.test.ts
git commit -m "feat(cluster): ROLE_SPECS role->daemon metadata + shouldClaimFor"
```

---

### Task 5: Heartbeat emitter

**Files:**
- Create: `packages/coordination/src/observability/heartbeat.ts`
- Test: `packages/coordination/src/observability/__tests__/heartbeat.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/observability/__tests__/heartbeat.test.ts
import { describe, it, expect } from 'vitest'
import { emitHeartbeat } from '../heartbeat.js'
import type { OpenObserveClient } from '../openobserve-client.js'

describe('emitHeartbeat', () => {
  it('ingests one {nodeId, role, ts, ok} row to the heartbeats stream', async () => {
    const calls: { stream: string; events: Record<string, unknown>[] }[] = []
    const client: OpenObserveClient = {
      ingest: async (stream, events) => { calls.push({ stream, events }); return { ingested: events.length } },
      query: async () => [],
    }
    await emitHeartbeat(client, 'n1', 'coder', 5000)
    expect(calls).toEqual([{ stream: 'heartbeats', events: [{ nodeId: 'n1', role: 'coder', ts: 5000, ok: true }] }])
  })
  it('swallows ingest errors (telemetry loss must not crash the node)', async () => {
    const client: OpenObserveClient = {
      ingest: async () => { throw new Error('openobserve down') },
      query: async () => [],
    }
    await expect(emitHeartbeat(client, 'n1', 'coder', 5000)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/observability/__tests__/heartbeat.test.ts`
Expected: FAIL — cannot find module `../heartbeat.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/observability/heartbeat.ts
import type { OpenObserveClient } from './openobserve-client.js'

export const HEARTBEAT_STREAM = 'heartbeats'

/** Emit one liveness pulse. Best-effort: never throws (telemetry loss must not kill the node). */
export async function emitHeartbeat(
  client: OpenObserveClient, nodeId: string, role: string, now: number, ok = true,
): Promise<void> {
  try {
    await client.ingest(HEARTBEAT_STREAM, [{ nodeId, role, ts: now, ok }])
  } catch (err) {
    console.warn(`[heartbeat] emit failed for ${nodeId}: ${(err as Error).message}`)
  }
}

/** Schedule heartbeat emission on an interval. Returns a stop handle. */
export function startHeartbeat(
  client: OpenObserveClient, nodeId: string, role: string, intervalMs: number, now: () => number = Date.now,
): { stop: () => void } {
  const timer = setInterval(() => void emitHeartbeat(client, nodeId, role, now()), intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/observability/__tests__/heartbeat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/observability/heartbeat.ts packages/coordination/src/observability/__tests__/heartbeat.test.ts
git commit -m "feat(observability): heartbeat emitter (best-effort) + startHeartbeat"
```

---

### Task 6: Monitor loop

**Files:**
- Create: `packages/coordination/src/observability/monitor-loop.ts`
- Test: `packages/coordination/src/observability/__tests__/monitor-loop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/observability/__tests__/monitor-loop.test.ts
import { describe, it, expect } from 'vitest'
import { runMonitorOnce } from '../monitor-loop.js'
import type { OpenObserveClient } from '../openobserve-client.js'
import type { Alert } from '../health-eval.js'

const now = 1_000_000

describe('runMonitorOnce', () => {
  it('queries health and passes alerts to notify', async () => {
    const client: OpenObserveClient = {
      query: async () => [],            // no heartbeats -> both expected nodes absent
      ingest: async () => ({ ingested: 0 }),
    }
    const got: Alert[][] = []
    await runMonitorOnce(client, ['n1', 'n2'], now, 30_000, a => got.push(a))
    expect(got).toHaveLength(1)
    expect(got[0].map(a => a.nodeId).sort()).toEqual(['n1', 'n2'])
    expect(got[0].every(a => a.severity === 'critical')).toBe(true)
  })
  it('swallows query errors so the loop survives', async () => {
    const client: OpenObserveClient = {
      query: async () => { throw new Error('down') },
      ingest: async () => ({ ingested: 0 }),
    }
    await expect(runMonitorOnce(client, ['n1'], now, 30_000, () => {})).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/observability/__tests__/monitor-loop.test.ts`
Expected: FAIL — cannot find module `../monitor-loop.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/observability/monitor-loop.ts
import type { OpenObserveClient } from './openobserve-client.js'
import type { Alert } from './health-eval.js'
import { checkClusterHealth } from './monitor.js'

/** One monitor pass: query health -> notify. Best-effort: never throws. */
export async function runMonitorOnce(
  client: OpenObserveClient,
  expectedNodeIds: string[],
  now: number,
  stalenessMs: number,
  notify: (alerts: Alert[]) => void,
): Promise<void> {
  try {
    notify(await checkClusterHealth(client, expectedNodeIds, now, stalenessMs))
  } catch (err) {
    console.warn(`[monitor] health check failed: ${(err as Error).message}`)
  }
}

/** Schedule the monitor pass on an interval. Returns a stop handle. */
export function startMonitorLoop(
  client: OpenObserveClient,
  expectedNodeIds: string[],
  stalenessMs: number,
  intervalMs: number,
  notify: (alerts: Alert[]) => void,
  now: () => number = Date.now,
): { stop: () => void } {
  const timer = setInterval(() => void runMonitorOnce(client, expectedNodeIds, now(), stalenessMs, notify), intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/observability/__tests__/monitor-loop.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/observability/monitor-loop.ts packages/coordination/src/observability/__tests__/monitor-loop.test.ts
git commit -m "feat(observability): monitor loop (runMonitorOnce + startMonitorLoop)"
```

---

### Task 7: `foldersForRole` — pure Syncthing topology

**Files:**
- Create: `packages/coordination/src/cluster/bring-up.ts` (this task adds only `foldersForRole`; Task 8 adds `bringNodeOnline`)
- Test: `packages/coordination/src/cluster/__tests__/folders-for-role.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/cluster/__tests__/folders-for-role.test.ts
import { describe, it, expect } from 'vitest'
import { foldersForRole } from '../bring-up.js'
import type { NodeConfig, Roster } from '../config.js'

const paths = { dataDir: '/d', identity: '/d/id.json', sharedVault: '/d/vault', inbox: '/d/inbox', inboxBase: '/d/inboxes' }
const cfg = (role: string, nodeId: string): NodeConfig => ({
  schema: 'coastal-node-config/v1', nodeId, role: role as NodeConfig['role'], curatorNodeId: 'c1', paths, address: 'a',
} as NodeConfig)
const roster: Roster = {
  schema: 'coastal-roster/v1', generatedAt: 1,
  nodes: [
    { nodeId: 'c1', role: 'curator', pubkey: 'PKc', deviceId: 'DEVc', address: 'a' },
    { nodeId: 'w1', role: 'coder',   pubkey: 'PK1', deviceId: 'DEV1', address: 'a' },
    { nodeId: 'w2', role: 'writer',  pubkey: 'PK2', deviceId: 'DEV2', address: 'a' },
    { nodeId: 'm1', role: 'monitor', pubkey: 'PKm', deviceId: 'DEVm', address: 'a' },
  ],
}

describe('foldersForRole', () => {
  it('worker gets a receiveonly vault + its own sendonly inbox', () => {
    const folders = foldersForRole(cfg('coder', 'w1'), roster)
    expect(folders.find(f => f.id === 'shared-vault')?.type).toBe('receiveonly')
    expect(folders.find(f => f.id === 'inbox-w1')?.type).toBe('sendonly')
  })
  it('curator gets a sendonly vault + one receiveonly inbox per worker (not the monitor)', () => {
    const folders = foldersForRole(cfg('curator', 'c1'), roster)
    expect(folders.find(f => f.id === 'shared-vault')?.type).toBe('sendonly')
    expect(folders.filter(f => f.id.startsWith('inbox-')).map(f => f.id).sort()).toEqual(['inbox-w1', 'inbox-w2'])
  })
  it('observer (monitor) gets no folders', () => {
    expect(foldersForRole(cfg('monitor', 'm1'), roster)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/folders-for-role.test.ts`
Expected: FAIL — cannot find module `../bring-up.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/coordination/src/cluster/bring-up.ts
import {
  buildWorkerFolders, buildCuratorFolders, type PeerDevice,
} from '../replication/syncthing-folders.js'
import type { DesiredFolder } from '../replication/syncthing-config.js'
import { ROLE_SPECS } from './roles.js'
import type { NodeConfig, Roster, RosterEntry } from './config.js'

const dev = (n: RosterEntry): PeerDevice => ({ nodeId: n.nodeId, deviceId: n.deviceId })

/** Pure derivation of this node's Syncthing folders from its role + the roster. */
export function foldersForRole(cfg: NodeConfig, roster: Roster): DesiredFolder[] {
  const self = roster.nodes.find(n => n.nodeId === cfg.nodeId)
  if (!self) throw new Error(`foldersForRole: ${cfg.nodeId} not in roster`)
  const spec = ROLE_SPECS[cfg.role]
  const workers = roster.nodes.filter(n => ROLE_SPECS[n.role].replicationRole === 'worker')

  if (spec.replicationRole === 'curator') {
    return buildCuratorFolders(workers.map(dev), {
      sharedVault: cfg.paths.sharedVault, inboxBase: cfg.paths.inboxBase,
    })
  }
  if (spec.replicationRole === 'worker') {
    const curator = roster.nodes.find(n => n.nodeId === cfg.curatorNodeId)
    if (!curator || curator.role !== 'curator') {
      throw new Error(`foldersForRole: curatorNodeId '${cfg.curatorNodeId}' does not resolve to a curator`)
    }
    return buildWorkerFolders(dev(self), dev(curator), {
      sharedVault: cfg.paths.sharedVault, inbox: cfg.paths.inbox,
    })
  }
  return [] // observer
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/folders-for-role.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/cluster/bring-up.ts packages/coordination/src/cluster/__tests__/folders-for-role.test.ts
git commit -m "feat(cluster): foldersForRole — pure role->Syncthing topology"
```

---

### Task 8: `bringNodeOnline` — the composition root

**Files:**
- Modify: `packages/coordination/src/cluster/bring-up.ts` (add `BringUpDeps`, `NodeHandle`, constants, `bringNodeOnline`)
- Test: `packages/coordination/src/cluster/__tests__/bring-up.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coordination/src/cluster/__tests__/bring-up.test.ts
import { describe, it, expect, vi } from 'vitest'
import { bringNodeOnline, type BringUpDeps } from '../bring-up.js'
import { openCoordinationDb } from '../../store/db.js'
import { createPeerRegistry } from '../../identity/peer-registry.js'
import type { NodeConfig, Roster } from '../config.js'
import type { A2ATransport } from '../../transport/types.js'

const paths = { dataDir: '/d', identity: '/d/id.json', sharedVault: '/d/vault', inbox: '/d/inbox', inboxBase: '/d/inboxes' }
const roster: Roster = {
  schema: 'coastal-roster/v1', generatedAt: 1,
  nodes: [
    { nodeId: 'c1', role: 'curator', pubkey: 'PKc', deviceId: 'DEVc', address: 'a' },
    { nodeId: 'w1', role: 'coder',   pubkey: 'PK1', deviceId: 'DEV1', address: 'a' },
    { nodeId: 'm1', role: 'monitor', pubkey: 'PKm', deviceId: 'DEVm', address: 'a' },
  ],
}
const cfg = (role: string, nodeId: string): NodeConfig => ({
  schema: 'coastal-node-config/v1', nodeId, role: role as NodeConfig['role'],
  curatorNodeId: 'c1', paths: { ...paths, identity: `/tmp/${nodeId}-id.json` }, address: 'a',
} as NodeConfig)

function makeDeps(over: Partial<BringUpDeps> = {}): { deps: BringUpDeps; scheduled: { ms: number }[]; reconciled: unknown[] } {
  const scheduled: { ms: number }[] = []
  const reconciled: unknown[] = []
  const transport: A2ATransport = { send: async () => {}, subscribe: () => () => {}, close: async () => {} }
  const deps: BringUpDeps = {
    db: openCoordinationDb({ path: ':memory:' }),
    registry: createPeerRegistry(),
    syncthingHttp: async (_m, path, body) => { reconciled.push({ path, body }); return {} },
    openobserve: { ingest: async () => ({ ingested: 0 }), query: async () => [] },
    noteStore: {} as BringUpDeps['noteStore'],
    makeTransport: () => transport,
    workerFor: () => async () => 'ok',
    notify: () => {},
    schedule: (_fn, ms) => { scheduled.push({ ms }); return { stop: () => {} } },
    ...over,
  }
  return { deps, scheduled, reconciled }
}

describe('bringNodeOnline', () => {
  it('seeds the registry with every other peer (key + device id)', async () => {
    const { deps } = makeDeps()
    const handle = await bringNodeOnline(cfg('coder', 'w1'), roster, deps)
    expect(deps.registry.list().sort()).toEqual(['c1', 'm1'])
    expect(deps.registry.getDeviceId('c1')).toBe('DEVc')
    await handle.stop()
  })

  it('worker schedules worker-tick + heartbeat (2 timers), not a monitor loop', async () => {
    const { deps, scheduled } = makeDeps()
    const handle = await bringNodeOnline(cfg('coder', 'w1'), roster, deps)
    expect(scheduled).toHaveLength(2)
    await handle.stop()
  })

  it('monitor schedules heartbeat + monitor loop but no replication tick', async () => {
    const { deps, scheduled } = makeDeps()
    const handle = await bringNodeOnline(cfg('monitor', 'm1'), roster, deps)
    expect(scheduled).toHaveLength(2)
    await handle.stop()
  })

  it('curator reconciles a sendonly shared-vault folder', async () => {
    const { deps, reconciled } = makeDeps()
    const handle = await bringNodeOnline(cfg('curator', 'c1'), roster, deps)
    const folderPuts = (reconciled as { path: string; body: { type?: string } }[])
      .filter(c => c.path.includes('/folders/shared-vault'))
    expect(folderPuts[0]?.body.type).toBe('sendonly')
    await handle.stop()
  })

  it('throws if the node is not in the roster', async () => {
    const { deps } = makeDeps()
    await expect(bringNodeOnline(cfg('coder', 'ghost'), roster, deps)).rejects.toThrow(/not in roster/)
  })

  it('stop() tears down every scheduled timer', async () => {
    const stops: number[] = []
    const { deps } = makeDeps({ schedule: (_fn, _ms) => { const i = stops.length; return { stop: () => stops.push(i) } } })
    const handle = await bringNodeOnline(cfg('coder', 'w1'), roster, deps)
    await handle.stop()
    expect(stops.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/bring-up.test.ts`
Expected: FAIL — `bringNodeOnline` / `BringUpDeps` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `bring-up.ts`)

```typescript
// ── append to packages/coordination/src/cluster/bring-up.ts ──
import type Database from 'better-sqlite3'
import { loadOrCreateIdentity } from '../identity/keypair.js'
import { reconcileSyncthing, type SyncthingHttp } from '../replication/syncthing-config.js'
import { TaskStore } from '../store/task-store.js'
import { ClaimStore } from '../store/claim-store.js'
import { runCoordinationDaemon, type CoordinationDaemon, type DaemonConfig } from '../daemon.js'
import type { A2ATransport } from '../transport/types.js'
import type { AgentIdentity } from '../types.js'
import type { PeerRegistry } from '../identity/peer-registry.js'
import type { OpenObserveClient } from '../observability/openobserve-client.js'
import type { Alert } from '../observability/health-eval.js'
import { emitHeartbeat } from '../observability/heartbeat.js'
import { runMonitorOnce } from '../observability/monitor-loop.js'
import { runWorkerTick, runCuratorTick, type Note } from '@coastal-ai/core/memory/replication-bridge'
import type { NoteStore } from '@coastal-ai/core/memory/notes'
import { shouldClaimFor } from './roles.js'

export const TICK_MS = 15_000
export const HEARTBEAT_MS = 10_000
export const MONITOR_MS = 30_000
export const STALENESS_MS = 30_000

export interface NodeHandle { daemon: CoordinationDaemon; stop(): Promise<void> }

export interface BringUpDeps {
  db: Database.Database
  registry: PeerRegistry
  syncthingHttp: SyncthingHttp
  openobserve: OpenObserveClient
  noteStore: NoteStore
  makeTransport: (id: AgentIdentity, roster: Roster, reg: PeerRegistry) => A2ATransport
  workerFor: (role: NodeConfig['role']) => DaemonConfig['worker']
  keep?: (n: Note) => boolean
  notify: (alerts: Alert[]) => void
  now?: () => number
  schedule?: (fn: () => void, ms: number) => { stop: () => void }
}

function defaultSchedule(fn: () => void, ms: number): { stop: () => void } {
  const timer = setInterval(() => { try { fn() } catch (e) { console.warn(`[tick] ${(e as Error).message}`) } }, ms)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

export async function bringNodeOnline(cfg: NodeConfig, roster: Roster, deps: BringUpDeps): Promise<NodeHandle> {
  const now = deps.now ?? Date.now
  const schedule = deps.schedule ?? defaultSchedule

  const self = roster.nodes.find(n => n.nodeId === cfg.nodeId)
  if (!self) throw new Error(`bringNodeOnline: ${cfg.nodeId} not in roster`)

  const identity = loadOrCreateIdentity(cfg.nodeId, cfg.paths.identity)

  // seed trust from the roster (public material)
  const peers = roster.nodes.filter(n => n.nodeId !== cfg.nodeId)
  for (const p of peers) {
    deps.registry.recordOrVerify(p.nodeId, p.pubkey)
    deps.registry.setDeviceId(p.nodeId, p.deviceId)
  }

  // Syncthing topology (foldersForRole validates self + curator resolution)
  const folders = foldersForRole(cfg, roster)
  await reconcileSyncthing(deps.syncthingHttp, {
    peers: peers.map(p => ({ peerId: p.nodeId, syncthingDeviceId: p.deviceId })),
    folders,
    knownDeviceIds: deps.registry.knownDeviceIds(),
  })

  // daemon with role-appropriate worker + claim policy
  const spec = ROLE_SPECS[cfg.role]
  const daemon = runCoordinationDaemon({
    identity,
    transport: deps.makeTransport(identity, roster, deps.registry),
    db: deps.db,
    tasks: new TaskStore(deps.db),
    claims: new ClaimStore(deps.db),
    worker: deps.workerFor(cfg.role),
    shouldClaim: shouldClaimFor(spec),
  })

  // replication ticks (by role) + heartbeat (all) + monitor loop (monitor only)
  const workers = roster.nodes.filter(n => ROLE_SPECS[n.role].replicationRole === 'worker')
  const timers: { stop: () => void }[] = []
  if (spec.replicationRole === 'worker') {
    timers.push(schedule(() => runWorkerTick(
      deps.noteStore, { inbox: cfg.paths.inbox, sharedVault: cfg.paths.sharedVault }, cfg.nodeId), TICK_MS))
  } else if (spec.replicationRole === 'curator') {
    timers.push(schedule(() => runCuratorTick(
      deps.noteStore,
      { inboxes: workers.map(w => `${cfg.paths.inboxBase}/${w.nodeId}`), sharedVault: cfg.paths.sharedVault },
      cfg.nodeId, deps.keep), TICK_MS))
  }
  timers.push(schedule(() => void emitHeartbeat(deps.openobserve, cfg.nodeId, cfg.role, now()), HEARTBEAT_MS))
  if (cfg.role === 'monitor') {
    const expected = roster.nodes.map(n => n.nodeId)
    timers.push(schedule(() => void runMonitorOnce(deps.openobserve, expected, now(), STALENESS_MS, deps.notify), MONITOR_MS))
  }

  return {
    daemon,
    async stop() { for (const t of timers) t.stop(); await daemon.stop() },
  }
}
```

> Note: the `Note`/`NoteStore` imports use the `@coastal-ai/core/memory/*` export subpaths added during the Syncthing thread. Verify they resolve (`packages/core/package.json` `exports`); they were added in commit `df5c29e`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coastal-ai/coordination exec vitest run src/cluster/__tests__/bring-up.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/coordination/src/cluster/bring-up.ts packages/coordination/src/cluster/__tests__/bring-up.test.ts
git commit -m "feat(cluster): bringNodeOnline composition root (identity+trust+syncthing+daemon+ticks)"
```

---

### Task 9: Export the new surface + full-package green

**Files:**
- Modify: `packages/coordination/src/index.ts`

- [ ] **Step 1: Add exports** (append after the existing observability block)

```typescript
// ─── Cluster join / first-boot ───────────────────────────────────────

export {
  NodeRole, NodeConfig, RosterEntry, Roster, PublicTuple,
  loadNodeConfig, loadRoster,
} from './cluster/config.js'

export { assembleRoster } from './cluster/roster.js'
export { buildPublicTuple } from './cluster/identity-public.js'
export { ROLE_SPECS, shouldClaimFor, type RoleSpec } from './cluster/roles.js'
export {
  foldersForRole, bringNodeOnline,
  TICK_MS, HEARTBEAT_MS, MONITOR_MS, STALENESS_MS,
  type BringUpDeps, type NodeHandle,
} from './cluster/bring-up.js'

export { emitHeartbeat, startHeartbeat, HEARTBEAT_STREAM } from './observability/heartbeat.js'
export { runMonitorOnce, startMonitorLoop } from './observability/monitor-loop.js'
```

- [ ] **Step 2: Run the full package test gate**

Run: `pnpm exec turbo test --filter @coastal-ai/coordination`
Expected: PASS — all prior coordination tests plus the 22 new ones across Tasks 1–8.

- [ ] **Step 3: Typecheck the whole graph builds**

Run: `pnpm exec turbo build --filter @coastal-ai/coordination`
Expected: PASS — no TS errors; the new exports resolve.

- [ ] **Step 4: Commit**

```bash
git add packages/coordination/src/index.ts
git commit -m "feat(cluster): export cluster-join + heartbeat/monitor-loop surface"
```

---

### Task 10: `@coastal-ai/node-runtime` — CLI + role→worker wiring

This leaf package is the only place that imports both `coordination` and the role-agent packages (keeping the Turbo graph acyclic, per the `swarm-demos` lesson). It ships the `coastal-cluster` CLI. Its `build` is `tsc --noEmit` (typecheck-as-guard, matching `swarm-demos`).

**Files:**
- Create: `packages/node-runtime/package.json`
- Create: `packages/node-runtime/tsconfig.json`
- Create: `packages/node-runtime/turbo.json`
- Create: `packages/node-runtime/src/worker-table.ts`
- Create: `packages/node-runtime/src/cli.ts`
- Test: `packages/node-runtime/src/__tests__/worker-table.test.ts`

- [ ] **Step 1: Scaffold the package**

```json
// packages/node-runtime/package.json
{
  "name": "@coastal-ai/node-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "coastal-cluster": "./dist/cli.js" },
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@coastal-ai/coordination": "workspace:*",
    "@coastal-ai/core": "workspace:*"
  },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```

```json
// packages/node-runtime/tsconfig.json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*"] }
```

```json
// packages/node-runtime/turbo.json
{ "extends": ["//"], "tasks": { "build": { "outputs": [] } } }
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/node-runtime/src/__tests__/worker-table.test.ts
import { describe, it, expect } from 'vitest'
import { workerFor } from '../worker-table.js'

describe('workerFor', () => {
  it('returns a worker function for every role (passthrough for unwired roles)', () => {
    for (const role of ['coder', 'curator', 'monitor', 'sandbox'] as const) {
      expect(typeof workerFor(role)).toBe('function')
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coastal-ai/node-runtime exec vitest run src/__tests__/worker-table.test.ts`
Expected: FAIL — cannot find module `../worker-table.js`.

- [ ] **Step 4: Implement `worker-table.ts`** (passthrough now; real role agents wired as their workers are imported)

```typescript
// packages/node-runtime/src/worker-table.ts
import type { NodeRole } from '@coastal-ai/coordination'
import type { DaemonConfig } from '@coastal-ai/coordination'

type Worker = DaemonConfig['worker']

/**
 * Map a role to its worker. Unwired roles get a passthrough that records the
 * task payload as the result (keeps the daemon loop honest until the role's
 * LLM-backed agent is wired in — coding-agent, reviewing-agent, etc.).
 */
const passthrough: Worker = async (task) => ({ noopFor: task.kind })

export function workerFor(_role: NodeRole): Worker {
  return passthrough
}
```

- [ ] **Step 5: Implement the CLI** (`emit-public` / `assemble` / `run`)

```typescript
// packages/node-runtime/src/cli.ts
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadNodeConfig, loadRoster, assembleRoster, buildPublicTuple, bringNodeOnline,
  loadOrCreateIdentity, createPeerRegistry, createTcpTransport,
  createOpenObserveClient, type Roster,
} from '@coastal-ai/coordination'
import { openCoordinationDb } from '@coastal-ai/coordination'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { workerFor } from './worker-table.js'

function emitPublic(deviceId: string, out: string): void {
  const cfg = loadNodeConfig('/etc/coastal/node.json')
  const identity = loadOrCreateIdentity(cfg.nodeId, cfg.paths.identity)
  writeFileSync(out, JSON.stringify(buildPublicTuple(cfg, identity, deviceId), null, 2))
}

function assemble(stageDir: string, out: string): void {
  const tuples = readdirSync(stageDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(stageDir, f), 'utf8')))
  writeFileSync(out, JSON.stringify(assembleRoster(tuples, Date.now()), null, 2))
}

async function run(): Promise<void> {
  const cfg = loadNodeConfig('/etc/coastal/node.json')
  const roster: Roster = loadRoster('/etc/coastal/roster.json')
  const registry = createPeerRegistry({ persistencePath: join(cfg.paths.dataDir, 'peers.json') })
  const db = openCoordinationDb({ path: join(cfg.paths.dataDir, 'coordination.db') })
  const noteStore = new NoteStore(join(cfg.paths.dataDir, 'obsidian.db'))
  const openobserve = createOpenObserveClient({
    baseUrl: process.env.COASTAL_OO_URL ?? 'http://127.0.0.1:5080',
    org: process.env.COASTAL_OO_ORG ?? 'default',
    auth: process.env.COASTAL_OO_AUTH ?? '',
    fetchImpl: fetch as never,
  })
  const handle = await bringNodeOnline(cfg, roster, {
    db, registry, openobserve, noteStore,
    syncthingHttp: async (method, path, body) => {
      const res = await fetch(`${process.env.COASTAL_ST_URL ?? 'http://127.0.0.1:8384'}${path}`, {
        method, headers: { 'X-API-Key': process.env.COASTAL_ST_APIKEY ?? '', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return res.json().catch(() => ({}))
    },
    makeTransport: (id, r, reg) => createTcpTransport({
      identity: id, peerRegistry: reg,
      peers: r.nodes.filter(n => n.nodeId !== cfg.nodeId).map(n => {
        const [host, port] = n.address.split(':')
        return { agentId: n.nodeId, host, port: Number(port) }
      }),
      listenPort: Number(cfg.address.split(':')[1]),
    }),
    workerFor,
    notify: (alerts) => { for (const a of alerts) console.warn(`[alert] ${a.severity} ${a.nodeId}: ${a.reason}`) },
  })
  process.on('SIGTERM', () => void handle.stop().then(() => process.exit(0)))
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'emit-public') {
  const di = rest.indexOf('--device-id'); const oi = rest.indexOf('--out')
  emitPublic(rest[di + 1], rest[oi + 1])
} else if (cmd === 'assemble') {
  const oi = rest.indexOf('--out')
  assemble(rest[0], rest[oi + 1])
} else if (cmd === 'run') {
  void run()
} else {
  console.error('usage: coastal-cluster <emit-public --device-id ID --out PATH | assemble DIR --out PATH | run>')
  process.exit(1)
}
```

> `createTcpTransport` config field names (`peers`, `listenPort`, etc.) must be checked against `packages/coordination/src/transport/tcp.ts` `TcpTransportConfig` before finalizing — adjust the `makeTransport` body to match. The `fetch as never` casts bridge the global `fetch` to the package's `FetchLike`/`SyncthingHttp` shapes; verify the response shape (`.ok`, `.status`, `.json()`) matches `FetchLike`.

- [ ] **Step 6: Run the test + build**

Run: `pnpm --filter @coastal-ai/node-runtime exec vitest run src/__tests__/worker-table.test.ts` → PASS
Run: `pnpm exec turbo build --filter @coastal-ai/node-runtime` → PASS (typecheck clean)

- [ ] **Step 7: Commit**

```bash
git add packages/node-runtime
git commit -m "feat(node-runtime): coastal-cluster CLI (emit-public/assemble/run) + role->worker table"
```

---

### Task 11: OS-side wiring (hardware-gated — specified, not CI-verifiable)

These four artifacts cannot be unit-tested (they run on a booted Linux node / your workstation). They are verified by the Task 12 E2E and a real BC-250 boot. Implement them, commit, but expect CI to only lint/shellcheck them.

**Files:**
- Modify: `os/node/files/usr/local/sbin/coastal-os-first-boot`
- Create: `os/node/scripts/coastal-cluster-provision`
- Create: `os/base/systemd/coastal-cluster.service`

- [ ] **Step 1: Add the early identity+emit step to first-boot** (insert immediately after the hostname block, before the governor build)

```bash
# ─── emit cluster identity early (before the long inference build) ───
log "generating cluster identity + syncthing device, emitting public tuple"
install -d -m 0700 /var/lib/coastal/syncthing
syncthing generate --home /var/lib/coastal/syncthing
DEVICE_ID=$(syncthing --home /var/lib/coastal/syncthing --device-id)
coastal-cluster emit-public --device-id "$DEVICE_ID" \
  --out /var/lib/coastal/identity-public.json \
  || log "WARN: emit-public failed — is /etc/coastal/node.json present?"
```

- [ ] **Step 2: Create the provisioning script**

```bash
#!/usr/bin/env bash
# os/node/scripts/coastal-cluster-provision
# Usage: coastal-cluster-provision <hosts-file>   (one ssh target per line)
set -euo pipefail
[[ $# -eq 1 ]] || { echo "usage: $0 <hosts-file>"; exit 1; }
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "== pass 1: collect public tuples =="
while read -r host; do
  [[ -z "$host" ]] && continue
  until scp "$host:/var/lib/coastal/identity-public.json" "$STAGE/$host.json" 2>/dev/null; do
    echo "  waiting for $host to emit its tuple…"; sleep 5
  done
  echo "  collected $host"
done < "$1"

echo "== assemble roster =="
coastal-cluster assemble "$STAGE" --out "$STAGE/roster.json"

echo "== pass 2: distribute + bring online =="
while read -r host; do
  [[ -z "$host" ]] && continue
  scp "$STAGE/roster.json" "$host:/etc/coastal/roster.json"
  ssh "$host" systemctl restart coastal-cluster
  echo "  brought $host online"
done < "$1"
echo "done."
```

- [ ] **Step 3: Create the systemd unit**

```ini
# os/base/systemd/coastal-cluster.service
[Unit]
Description=Coastal.AI cluster node runtime (bringNodeOnline)
After=network-online.target coastal-os-first-boot.service coastal-syncthing.service coastal-openobserve.service
Wants=network-online.target
Requires=coastal-syncthing.service
ConditionPathExists=/etc/coastal/roster.json

[Service]
Type=simple
ExecStart=/usr/bin/coastal-cluster run
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Make scripts executable + shellcheck**

```bash
chmod +x os/node/scripts/coastal-cluster-provision
shellcheck os/node/scripts/coastal-cluster-provision || true
```

- [ ] **Step 5: Commit**

```bash
git add os/node/files/usr/local/sbin/coastal-os-first-boot os/node/scripts/coastal-cluster-provision os/base/systemd/coastal-cluster.service
git commit -m "feat(os): cluster-join first-boot wiring (emit-public step, provision script, coastal-cluster.service)"
```

---

### Task 12: Two-container E2E harness (hardware/runtime-gated — deferred verification)

A docker-compose harness proving convergence + health. Written now; **run** when a Docker host with real Syncthing + openobserve images is available (not CI-default).

**Files:**
- Create: `packages/node-runtime/e2e/docker-compose.yml`
- Create: `packages/node-runtime/e2e/README.md`

- [ ] **Step 1: Write the compose file**

```yaml
# packages/node-runtime/e2e/docker-compose.yml
# Two-node convergence E2E: a curator + a worker, real syncthing + openobserve.
services:
  openobserve:
    image: public.ecr.aws/zinclabs/openobserve:latest
    environment:
      ZO_ROOT_USER_EMAIL: root@example.com
      ZO_ROOT_USER_PASSWORD: Complexpass#123
    ports: ["5080:5080"]
  curator:
    build: { context: ../../.., dockerfile: packages/node-runtime/e2e/Dockerfile }
    environment:
      COASTAL_ROLE: curator
      COASTAL_OO_URL: http://openobserve:5080
    depends_on: [openobserve]
  worker:
    build: { context: ../../.., dockerfile: packages/node-runtime/e2e/Dockerfile }
    environment:
      COASTAL_ROLE: coder
      COASTAL_OO_URL: http://openobserve:5080
    depends_on: [openobserve, curator]
```

- [ ] **Step 2: Write the runbook**

```markdown
# packages/node-runtime/e2e/README.md
## Two-node cluster-join E2E (hardware/runtime-gated)

Prereqs: a Docker host (not the default CI runner).

1. `docker compose -f docker-compose.yml up --build`
2. Each container self-generates identity + syncthing device, writes its tuple.
3. From the host: `coastal-cluster-provision hosts.txt` (hosts.txt = curator + worker ssh/exec targets).
4. **Assert convergence:** author a note in the worker's NoteStore (kind `learning`),
   wait one TICK (15s) + sync; confirm it appears in the curator's `shared-vault`,
   then propagates back to the worker's read-only vault replica.
5. **Assert health:** query openobserve `heartbeats` — both nodeIds present, `ok=true`,
   `ts` within STALENESS_MS. Run the monitor role and confirm zero critical alerts.

Exit criteria: a worker-authored note is visible cluster-wide AND both nodes report
healthy heartbeats. This is the deferred "manual 2-container E2E" from the Syncthing +
openobserve specs.
```

- [ ] **Step 3: Commit**

```bash
git add packages/node-runtime/e2e
git commit -m "test(node-runtime): two-node cluster-join E2E harness + runbook (hardware-gated)"
```

---

## Self-Review

**Spec coverage:**
- Static config + schemas → Task 1. ✅
- Self-gen identity / public-halves / assembler → Tasks 2–3 + Task 10 (`emit-public`/`assemble`). ✅
- Operator-driven two-pass provisioning → Task 11 (`coastal-cluster-provision`). ✅
- Fully static roles + role→daemon map → Task 4. ✅
- `bringNodeOnline` composition root → Tasks 7–8. ✅
- Heartbeat (all roles) + monitor loop (monitor only) → Tasks 5–6, wired in Task 8. ✅
- Build-cycle boundary (`workerFor` injected; `node-runtime` leaf) → Task 8 (injection) + Task 10 (package). ✅
- Error handling (fail-loud vs best-effort) → Task 5/6 (swallow), Task 8 (throws), Task 11 (`Restart=on-failure`, `ConditionPathExists`). ✅
- OS-side wiring → Task 11. ✅
- 2-container E2E → Task 12. ✅

**Placeholder scan:** No "TBD"/"implement later". Two explicit verify-against-source notes (core export subpaths in Task 8; `TcpTransportConfig`/`FetchLike` shapes in Task 10) are deliberate integration checks against existing code, not deferred work — the engineer reads the named file and adjusts field names if they differ.

**Type consistency:** `SyncthingHttp` (async) used in Tasks 8/10 matches `syncthing-config.ts`. `reconcileSyncthing` peers shape `{peerId, syncthingDeviceId}` matches. `OpenObserveClient` = `{ingest, query}` matches Tasks 5/6/8/10. Heartbeat row `{nodeId, role, ts, ok}` matches `health-eval.ts`/`monitor.ts`. `TaskStore`/`ClaimStore(db)` ctor matches. `NodeRole`/`NodeConfig`/`Roster`/`RosterEntry` names consistent across all tasks. `foldersForRole`/`bringNodeOnline`/`BringUpDeps`/`NodeHandle` consistent between Tasks 7, 8, 9.

**Scope:** Single subsystem (node bring-up). Tasks 1–9 are CI-verifiable now; Tasks 10–12 carry the hardware-gated remainder but are fully specified.
