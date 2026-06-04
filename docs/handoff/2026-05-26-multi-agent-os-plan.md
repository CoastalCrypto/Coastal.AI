# Handoff — Multi-Agent OS Plan

**Date:** 2026-05-26
**Status:** Planning complete. Phase 0 prep + Phase 1 scaffolding starting in parallel.
**Supersedes (in spirit, not in fact):** [`2026-05-12-master-state-and-next-steps.md`](./2026-05-12-master-state-and-next-steps.md) — that doc is still authoritative for what shipped through `8dde158` (v1.7.0-dev). This doc lays out the next major direction: a multi-agentic OS deployable as a single device or cluster.
**Tests at handoff time:** 371 passing (per 2026-05-12 baseline; this plan adds, doesn't change, existing tests).

---

## TL;DR

The roadmap pivots from incremental v1.7-dev improvements to a **multi-agentic OS**. First deployment target: an **ASRock 12-bay BC-250 server** (hardware in hand, not yet racked). Each BC-250 runs Coastal.AI OS + a role-specialized LLM. Agents communicate via the **A2A protocol** over LAN (primary) with **Telegram/Discord** as out-of-band fallback. Curation is shared between the user and a designated **main agent**.

The build is structured as six phases (Phase 0–5), staged so software work proceeds in parallel with hardware bring-up. Phase 0 is a one-afternoon hardware smoke test (gated on rack-up). Phase 1 introduces a new peer package — `@coastal-ai/coordination` — with a durable task board, A2A message envelopes, and a 6-state task lifecycle backed by a 3-table schema (the "super-option" agreed 2026-05-26).

Nothing in this plan breaks existing v1.7-dev behavior. The coordination layer is opt-in: install + import to enable, ignore to keep the current single-daemon architect intact.

---

## Vision

**One sentence:** Coastal.AI becomes a multi-agentic OS where each agent is a specialized peer — running on its own device with its own role-tuned LLM — communicating with the rest of the swarm over local network (primary) or messaging gateways (fallback), curated by the user and a main orchestrator.

**Two layers, same brain:**

1. **Coastal.AI on host OS** (Windows/Mac/Ubuntu) — the broad adoption path. Anyone with a recent laptop can install and run the daemon + web UI, optionally joining a cluster as a remote node.
2. **Coastal.AI OS** — a bootable distribution (Debian-based) that ships the same daemon, but adds deterministic boot, hardware-coupled identity, and a clean distribution lane (`origin/apt` already exists for this). The OS version is **not** a fork of the host version — it's the same code, deterministically packaged.

The OS layer is required for the BC-250 cluster (these cards boot their own Linux; there's no host OS to install onto). It's not required for adoption — host-installed Coastal.AI remains a first-class deployment.

---

## First deployment target: 12× BC-250 cluster

**Hardware:** ASRock 12-bay BC-250 server chassis (user-owned, in hand). Each bay houses one BC-250 card.

**Per-card specs:**
- AMD APU (Zen 2 CPU + RDNA 2 iGPU, ~24 CUs)
- 16 GB GDDR6 shared between CPU and iGPU
- 1 GbE NIC
- M.2 NVMe slot (boot media — user confirmed NVMe over microSD)
- ~10–15 W idle / ~120 W load
- **Each card is a complete computer** — boots its own Linux, has its own IP. Not a coprocessor.

**Cluster totals:**
- ~192 GB pooled VRAM across 12 nodes
- ~1.5 kW peak (needs at least a dedicated 20 A circuit at 120 V US, or 240 V)
- 12 IPs on internal LAN, switched by user-owned managed switch

**Why this is the right test bed:**
- Cheapest path to a true 12-node mesh with non-trivial inference at each node
- Forces a clean A2A protocol — you can't shortcut to in-process function calls when nodes are physically separate
- Inference path is solved by [`TechMakesArt/llama.cpp-bc250`](https://github.com/TechMakesArt/llama.cpp-bc250) (Vulkan, gfx1013) — already in user's starred repos
- Once it works on 12 BC-250s in a chassis, it works on 12 nodes anywhere — the chassis is just a dense form factor

**Current hardware state (2026-05-26):** hardware + switch acquired. Not yet racked, powered, or networked.

**Known BC-250 quirks** (worth knowing before power-on):
- Most ship with vendor mining BIOS that forces PCIe to x1 and disables the iGPU entirely. A community-modded BIOS with **gfx1013 PCIe bridge patches** is required for inference. Reversible via `flashrom` or the chassis BMC tool.
- `llama.cpp-bc250` was last pushed 2026-04-19 (small fork, 2 stars). Phase 0 prep includes verifying it still builds against current `ggerganov/llama.cpp` main, or falling back to [`Kaden-Schutt/hipfire`](https://github.com/Kaden-Schutt/hipfire) (RDNA-native Rust, 399 stars, actively maintained).

---

## Architectural layers

```
┌─────────────────────────────────────────────────────────────────┐
│ USER LAYER                                                      │
│   • Web mission control (one node hosts the UI, or external)    │
│   • Telegram / Discord bot (mobile-friendly cluster access)     │
│   • Voice (VoxCPM + supertonic — both ONNX, both in stars)      │
├─────────────────────────────────────────────────────────────────┤
│ ORCHESTRATION LAYER                                             │
│   • Main agent (one node) — curates the shared task board       │
│   • Durable Kanban (Hermes Tenacity pattern, super-option)      │
│   • Shared notes substrate (replicated v1.7 obsidian.db)        │
├─────────────────────────────────────────────────────────────────┤
│ COORDINATION LAYER (new in v2.0)                                │
│   • A2A protocol over LAN (primary)                             │
│   • Telegram / Discord as fallback channel (off-LAN agents)     │
│   • mDNS / Avahi for node auto-discovery                        │
│   • Per-node Ed25519 identity, A2A messages signed              │
├─────────────────────────────────────────────────────────────────┤
│ AGENT RUNTIME (per node, 12×)                                   │
│   • Coastal.AI daemon (architect + role-specific peer package)  │
│   • Role-specialized LLM (different model per node)             │
│   • Local notes substrate + lossless DB                         │
│   • Telegram / Discord bridge (gateway-eligible nodes only)     │
├─────────────────────────────────────────────────────────────────┤
│ COASTAL.AI OS (per node, 12×)                                   │
│   • Minimal Debian base, BC-250 kernel modules                  │
│   • llama.cpp-bc250 (Vulkan) preinstalled as inference engine   │
│   • Read-only root + writable overlay for state                 │
│   • First-boot config: keypair gen, role pick, hardware scan,   │
│     model download, cluster join                                │
│   • OTA via existing `origin/apt` lane                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12-agent role map (proposed, not yet finalized)

| Node | Role | Model (q4) | VRAM | Rationale |
|---|---|---|---|---|
| 1 | **Main / Planner** | Llama 3.1 13B | ~9 GB | Largest model, orchestrates; lives on the chassis with the best cooling slot |
| 2 | **Coder** | Qwen2.5-Coder-7B | ~5 GB | Code synthesis |
| 3 | **Reviewer** | DeepSeek-Coder-V2-Lite | ~9 GB | Independent review of code from node 2 |
| 4 | **Tester** | CodeLlama-7B | ~5 GB | Test generation |
| 5 | **Designer (vision)** | LLaVA-1.6 7B | ~7 GB | UI/design judgment, supports DOM-snapshot gate from v1.7-C1 |
| 6 | **Researcher** | Llama 3.1 8B + web tools | ~5 GB | Web search + synthesis |
| 7 | **Writer** | Qwen2.5-7B | ~5 GB | Documentation, summaries, handoff docs |
| 8 | **Trader** | Kronos sidecar (existing) | ~3 GB | Already shipped in `trading-architect` |
| 9 | **Curator** | Phi-3.5-mini 3.8B | ~3 GB | Always-on notes substrate grading/pruning (Hermes v0.12 pattern) |
| 10 | **Monitor / Watchdog** | Phi-3.5-mini 3.8B | ~3 GB | Health checks, zombie reclaim, alerting |
| 11 | **Sandbox / Exec** | — (runner only) | — | Isolated code execution surface |
| 12 | **Voice / TTS / Bridge** | Whisper + VoxCPM + small LLM | ~6 GB | Voice in/out, Telegram/Discord gateway |

Role-to-card-slot mapping is an **open design decision** (see below) — locked-by-slot vs. config-driven.

---

## Phase plan

| Phase | Focus | OS version | Status | ETA | Hardware needed |
|---|---|---|---|---|---|
| **0** | De-risk BC-250 inference | **v0.0.1** (first cut) | ✅ **PREP COMPLETE 2026-05-26** — awaiting rack-up to execute bench | 1 afternoon (post rack-up) | 1 BC-250, racked + powered + on network |
| **1** | Coordination peer package + super-option schema | — (dev box) | ✅ **COMPLETE 2026-05-26** — 80/80 tests passing | shipped | None — dev box only |
| **2** | Two-node A2A | v0.0.1 → v0.0.2 (add coordination package) | ✅ **SOFTWARE COMPLETE 2026-05-26** — TCP+mDNS+TOFU | shipped | Awaits 1 BC-250 racked to validate over LAN |
| **4 prep** | Replication + role-agents + mission control | v0.0.x | ✅ **COMPLETE 2026-05-29** — broadcast replication w/ logical-clock guards · 3 demos (basic / full-stack / live) · 5 role-agent packages (curator, coding, reviewing, planner + existing trading) · `@coastal-ai/llm-client` · `@coastal-ai/mission-control` (HTTP+SSE dashboard at http://localhost:PORT/) · `createCuratorDaemon` for scheduled cycles | shipped | Awaits hardware to validate cluster |
| **5 prep** | Telegram A2A bridge | v0.0.x | ✅ **COMPLETE 2026-05-28** — `createTelegramTransport` w/ injectable client; TOFU + signature verification; 4096-char cap | shipped | Production wiring of telegraf/grammy + bot token |
| **3** | First-boot wizard, overlayfs, role picker | **v0.1 release** | Outlined | ~2 weeks | 1 BC-250 + ability to flash NVMe |
| **4** | Full 12-node cluster | **v1.0 release** | Outlined | ~2 weeks | Full chassis racked |
| **5** | Out-of-band gateway | v1.1 | Outlined | ~1 week | Telegram/Discord bot tokens |

**OS version progression rule:** every image we ship is Coastal.AI OS at some version. We do not ship "Debian + scripts" as a separate product — v0.0.1 IS Coastal.AI OS at its earliest. Phase 3 isn't "build the OS"; it's "release v0.1 of the OS that's been evolving since Phase 0." Same identity, same apt lane, accreting features.

**Parallelism plan:** Phase 0 prep and Phase 1 software work proceed in parallel during hardware rack-up. When the rig is up, Phase 0 executes immediately; when Phase 0 passes, Phase 2 unblocks and runs concurrently with the tail of Phase 1.

---

## Phase 0 — De-risk BC-250 inference (current)

**Goal:** A single number — tokens/sec on a 7B q4 model with 2k input + 512 output, measured on one BC-250 with `llama.cpp-bc250` (Vulkan path).

**Why this gate:** If a BC-250 can't sustain interactive-speed inference (target: ≥ 10 tok/s for the 7B class, ≥ 5 tok/s for the 13B class), the role map needs revising and possibly the hardware target itself. Better to find out before writing two weeks of coordination code that assumes the per-node performance profile.

### Prep tasks (no hardware needed)

1. **Verify `llama.cpp-bc250` builds against current upstream.** Last pushed 2026-04-19. If stale, identify rebase scope or pivot to `hipfire`.
2. **Stage Coastal.AI OS v0.0.1 as a flashable NVMe image.** This is the *first* version of the OS — not a throwaway Debian image. Contents:
   - Debian 12 (Bookworm) minimal base — same base used by all future OS versions
   - Coastal branding: `/etc/os-release` reports `Coastal.AI OS 0.0.1`, motd shows version + role placeholder, hostname pattern `coastal-<short-mac>`
   - Filesystem layout: `/opt/coastal/` for the daemon, `/var/lib/coastal/` for state
   - `llama.cpp-bc250` (or `hipfire`) prebuilt and on PATH
   - Existing `hardware-scan` module from `packages/core/src/models/hardware-scan.ts`
   - `coastal-os-bench` script (the Phase 0 benchmark tool — establishes the `/usr/local/bin/coastal-*` naming convention)
   - SSH enabled on first boot (with a fresh key, not a stale one)
   - Network-on-first-boot (DHCP, mDNS hostname)
   - apt source pre-pointed at `origin/apt` lane — even v0.0.1 is installable/upgradable via apt
3. **Write the benchmark script + prompt corpus** — single command, JSON output, fields: model, quant, tok/s, prompt-processing-ms, peak-vram-mb, peak-power-w.
4. **Document BIOS reflash path** — which community-modded BIOS is canonical, `flashrom` recipe, recovery steps if the flash bricks the card.

### Execution checklist (post rack-up)

1. Rack the chassis, connect PSU, connect switch, power on.
2. Identify one card for the smoke test (suggest slot 1 — the eventual Main node, so the BIOS work isn't wasted).
3. Reflash that card to the modded BIOS (community-recommended; flashrom or BMC tool).
4. `dd` the staged Coastal.AI OS v0.0.1 image to its NVMe.
5. Boot the card; SSH in via the cluster's switch.
6. Download a 7B q4 model (Qwen2.5-Coder-7B is a good representative).
7. Run the benchmark script.
8. **Decision:** ≥ 10 tok/s → green-light Phase 1 architecture as-is. < 5 tok/s → revisit role map and consider lighter models. In between → green-light but flag heavy roles for later optimization.

---

## Phase 1 — Coordination peer package (current parallel work)

**Goal:** Two daemon processes on localhost handing off a task to each other, validating the full A2A + task-board + state-machine stack.

### Package shape

`packages/coordination/` — new peer package, mirroring `packages/trading-architect/` exactly:

```
packages/coordination/
  package.json          @coastal-ai/coordination, workspace:* on core
  tsconfig.json
  vitest.config.ts
  src/
    index.ts            Side-effect: registerKind('task'), ('handoff'), ('heartbeat')
                        Re-exports: TaskStore, A2ATransport, runCoordinationDaemon
    types.ts            TaskState, Task, TaskClaim, TaskDependency, A2AMessage
    store/
      schema.sql        3 tables: tasks, task_claims, task_dependencies
      task-store.ts     CRUD + state transitions
      claim-store.ts    Claim history (append-only)
      dependency-store.ts  Dep graph CRUD
    transitions/
      state-machine.ts  Validated transition table
      handoff.ts        Atomic claim-release + new-claim insertion
      reclaim.ts        Zombie detection from stale heartbeats
      cascade.ts        Dependency cascade (must_not_fail propagation)
    resolver/
      dependency-resolver.ts  Background process: blocked → queued when deps clear
    transport/
      a2a-envelope.ts   Ed25519-signed message envelopes
      localhost.ts      In-memory transport (Phase 1)
      tcp.ts            Wire transport (Phase 2, stubbed in Phase 1)
    identity/
      keypair.ts        Per-node Ed25519 keypair (generate + load + persist)
    daemon.ts           runCoordinationDaemon — pulls it together
  __tests__/
    state-machine.test.ts
    handoff.test.ts
    reclaim.test.ts
    cascade.test.ts
    dependency-resolver.test.ts
    a2a-envelope.test.ts
    two-daemon-handoff.test.ts   The end-to-end smoke
```

### Super-option schema

The "super-option" agreed 2026-05-26 — three tables, six-state task lifecycle, separate claims audit log, dependency graph. Lean implementation up front, rich shape so Phase 2+ inherits free machinery.

#### Task

```ts
export type TaskState =
  | 'queued'      // exists in the board, ready to be claimed
  | 'claimed'     // someone holds an active claim (heartbeat required)
  | 'blocked'     // waiting on dependencies to clear
  | 'done'        // success — terminal
  | 'failed'      // retries exhausted — terminal
  | 'cancelled'   // killed externally — terminal

export interface Task {
  id: string
  state: TaskState
  kind: string                     // task type, e.g. 'code', 'review', 'eval'
  payload: unknown                 // task-type-specific input data
  result: unknown | null           // populated on 'done'
  failureReason: string | null     // populated on 'failed' or 'cancelled'
  ownerAgentId: string | null      // denormalized from active claim; fast queries
  retryCount: number
  maxRetries: number
  createdAt: number
  updatedAt: number
  parentTaskId: string | null      // for subtask trees
}
```

#### Claim (append-only audit log)

```ts
export interface TaskClaim {
  id: string                       // claim id
  taskId: string
  agentId: string
  claimedAt: number
  lastHeartbeat: number            // updated by heartbeats; stale → reclaim candidate
  releasedAt: number | null        // null = currently held
  releaseReason: 'completed' | 'handoff' | 'reclaimed' | 'cancelled' | null
  handoffToAgentId: string | null  // populated when releaseReason === 'handoff'
}
```

#### Dependency

```ts
export interface TaskDependency {
  taskId: string
  dependsOnTaskId: string
  kind: 'must_complete' | 'must_not_fail'
}
```

- `must_complete` — dependent task stays `blocked` until dep is `done`. If dep moves to `failed`/`cancelled`, dependent stays `blocked` (manual intervention required).
- `must_not_fail` — dependent task stays `blocked` until dep is `done`. If dep moves to `failed`/`cancelled`, dependent is automatically `cancelled` (cascading failure).

### State transitions (validated)

| From | To | Trigger |
|---|---|---|
| `queued` | `claimed` | Agent claims (creates a claim row, sets `ownerAgentId`) |
| `queued` | `blocked` | Dependency added that's not yet `done` |
| `queued` | `cancelled` | External cancel (user / main agent) |
| `claimed` | `done` | Agent reports success (releases claim with `releaseReason='completed'`) |
| `claimed` | `failed` | Retries exhausted (releases claim with `releaseReason='reclaimed'` then increments retry; final failure releases with `releaseReason='cancelled'` and marks task `failed`) |
| `claimed` | `queued` | Heartbeat expired (reclaim — releases claim with `releaseReason='reclaimed'`, clears `ownerAgentId`) |
| `claimed` | `queued` | **Handoff** — INSERT new claim for receiver, UPDATE old claim with `releaseReason='handoff'` + `handoffToAgentId=<receiver>`, UPDATE task's `ownerAgentId=<receiver>` — all in one transaction. Then task immediately transitions back to `claimed` with the new owner. |
| `claimed` | `cancelled` | External cancel mid-flight |
| `blocked` | `queued` | All `must_complete` deps in `done` state (dependency resolver) |
| `blocked` | `cancelled` | Any `must_not_fail` dep in `failed` or `cancelled` state (cascade) |
| `failed` | `queued` | Manual revive (user/main agent) |

`done` and `cancelled` are terminal — no outgoing transitions.

### Handoff semantics (the super-option's key win)

When agent A passes work to agent B:

```ts
async function handoff(taskId: string, fromAgentId: string, toAgentId: string): Promise<void> {
  await db.transaction(async () => {
    // 1. INSERT new claim for the receiver
    await insertClaim({
      taskId, agentId: toAgentId, claimedAt: now(), lastHeartbeat: now(),
      releasedAt: null, releaseReason: null, handoffToAgentId: null,
    })
    // 2. UPDATE the old claim — release with handoff reason
    await releaseClaim({
      taskId, agentId: fromAgentId,
      releasedAt: now(), releaseReason: 'handoff', handoffToAgentId: toAgentId,
    })
    // 3. UPDATE the task — owner changes, state stays 'claimed' (no churn)
    await updateTask(taskId, { ownerAgentId: toAgentId })
  })
}
```

**Result:** the task never re-enters `queued`, no other agent can race-claim it during transfer, and the full handoff chain is queryable from the claims table.

Per the user's earlier framing ("B owns, A can observe"): once handoff completes, A has no privileged access to the task. The claim history shows A's involvement; that's the observability.

### Dependency resolver

A background loop on the coordination daemon:

```ts
async function resolveDependencies(): Promise<void> {
  // 1. Find all 'blocked' tasks whose must_complete deps are all 'done'
  //    → transition each to 'queued'
  // 2. Find all 'blocked' tasks with ANY must_not_fail dep in 'failed' or 'cancelled'
  //    → transition each to 'cancelled' with failureReason='cascaded'
}
```

Runs on a configurable interval (default 5s). Cheap query — both lookups are indexed JOINs.

### A2A protocol

Adopting [`a2aproject/A2A`](https://github.com/a2aproject/A2A) for the wire format. Message envelope:

```ts
export interface A2AMessage {
  version: '0.1'
  messageId: string              // UUID v7 — sortable
  from: {
    agentId: string
    publicKey: string            // Ed25519 public key, base64
  }
  to: string | '*'               // agentId or broadcast
  timestamp: number
  kind: 'task.claim' | 'task.heartbeat' | 'task.complete' | 'task.handoff'
      | 'task.cancel' | 'task.observe' | 'agent.hello' | 'agent.goodbye'
  payload: unknown               // kind-specific
  signature: string              // Ed25519 over canonical-JSON(message minus signature)
}
```

- **Identity:** Each node generates an Ed25519 keypair on first boot. Persisted to `<dataDir>/identity.key` (0600 perms). Public key is the agent's stable ID; the keypair signs every outbound message.
- **Verification:** Inbound messages are rejected if signature fails OR if `from.publicKey` doesn't match the known key for that `agentId` (TOFU on first contact, then locked).
- **Transports (Phase 1):** in-memory localhost transport for two-daemon-on-one-box tests.
- **Transports (Phase 2):** TCP with mDNS discovery, then Telegram/Discord adapters.

### Coastal.AI core changes required

Surgical and additive — no breaking changes to existing v1.7-dev:

1. **`packages/core/src/memory/kinds-registry.ts`** — no code change; coordination package will register `task`, `handoff`, `heartbeat` via its `src/index.ts` side-effect (mirrors trading-architect's `registerKind('trade')`).
2. **`packages/core/src/memory/notes.ts`** — extend `LINK_KINDS` (currently closed enum: `mentions | derives_from | contradicts | supersedes | contains`) to include `claims`, `delegates_to`, `produces`. This is a closed enum so plugins can't extend it — but coordination is core-adjacent enough that adding 3 entries is justified.
3. **`packages/core/src/architect/types.ts`** — `FAILURE_KINDS` is fine as-is; coordination introduces its own task-state vocabulary that doesn't conflict.

### Phase 1 tests

`packages/coordination/__tests__/` — vitest, in-memory SQLite for speed:

- `state-machine.test.ts` — every transition validated, every invalid transition rejected.
- `handoff.test.ts` — atomic transfer, no intermediate queued state visible to other agents.
- `reclaim.test.ts` — heartbeat expires → claim released with `releaseReason='reclaimed'`, task back to `queued`.
- `cascade.test.ts` — `must_not_fail` dep moves to `failed` → dependent moves to `cancelled` with correct reason.
- `dependency-resolver.test.ts` — `blocked` → `queued` when deps clear; ignores tasks with open deps.
- `a2a-envelope.test.ts` — sign + verify roundtrip; tampered messages rejected; wrong-pubkey rejected.
- `two-daemon-handoff.test.ts` — end-to-end smoke: two daemons on localhost, Main creates a task, Coder claims it, Coder completes it, Main observes completion via the claims table.

---

## Phases 2–5 (outlined)

### Phase 2 — Two-node A2A (~3 days)

Same coordination code from Phase 1, but Main is on the laptop and Coder is on the first BC-250.

- mDNS discovery (Avahi on BC-250 side; `bonjour-service` npm on laptop side)
- TCP transport for A2A envelopes
- Identity: TOFU on first contact, locked thereafter
- Open question: do A2A messages go peer-to-peer, or through a central broker? Phase 2 starts peer-to-peer (simpler), revisits at Phase 4 scale.

### Phase 3 — Coastal.AI OS v0.1 release (~2 weeks)

**This is the v0.0.1 image from Phase 0, evolved.** Same base, same branding, same apt lane — adds the features that turn a benchmark image into a usable cluster node:

- `coastal-ai-bootstrap` package adds the first-boot wizard:
  1. Generate Ed25519 keypair (persisted to `/var/lib/coastal/identity.key`, 0600)
  2. Hardware scan (existing module — extend to detect BC-250 specifically and pick the right model)
  3. Role picker (presents the 12-role map, locked or default-by-slot per open decision #3)
  4. Model download (HuggingFace or local mirror)
  5. Cluster join (mDNS discover + handshake)
- Read-only root + writable overlay (overlayfs) so config drift is bounded
- OTA already works (`apt update && apt upgrade`) — same lane v0.0.1 uses, just more packages flowing through it now

### Phase 4 — Full 12-node cluster (~2 weeks)

- Remaining role peer packages: `@coastal-ai/coding-agent`, `@coastal-ai/reviewing-agent`, `@coastal-ai/curator-agent`, etc. Each is small — wraps the architect daemon with role-specific prompts + skill set.
- **Shared notes substrate** — replication model (see open decisions below)
- **Mission control UI** — extend existing web UI to surface all 12 nodes: status, current task, model, recent claims. Live-stream via SSE (already in v1.5).

### Phase 5 — Out-of-band gateway (~1 week)

- Telegram bot + Discord bot, each as adapters over the existing A2A transport
- User commands routed to the main agent
- Cross-network agents (e.g., a laptop on a different LAN) join the swarm via the gateway, not directly
- Per-platform reply etiquette (thread vs. DM vs. channel)

---

## Open design decisions (not yet committed)

1. **Notes-substrate replication model** — full CRDT sync (e.g., Yjs) / master-replica / compressed-summary gossip (Hermes claude-mem style) / per-node-local-only-with-RPC. Decision shapes every other layer's perf and consistency.
2. **Main agent assignment** — static role (slot 1 is always Main) or elected via gossip when current Main fails?
3. **Role assignment at boot** — locked to physical card slots (deterministic, easy to reason about) or config-file driven (flexible, can be changed without re-flashing)?
4. **LAN → Telegram fallback** — explicit user toggle, or automatic on LAN failure detection?
5. **Claims table pruning policy** — never (grows unbounded), age-based (delete > N days), count-based (keep last N per task), or hand-off to the Curator agent?
6. **Phase 2 mDNS discovery** — `avahi-daemon` on the BC-250 side, or a custom Node-side implementation (e.g., `bonjour-service`)?
7. **Main agent's task-board scope** — does Main own the only authoritative board (single point of truth), or do all nodes have local boards that sync (resilient but consistency-hard)?

---

## Coastal.AI monorepo prerequisites — already in place

Tier-2 refactor (commit `546b123`, 2026-05-12) already shipped most of what this plan depends on:

- **Kinds-registry** is extensible for `task`, `handoff`, `heartbeat`, `claim`
- **DI pattern** means transport layer is swappable (localhost ↔ TCP ↔ messaging gateway)
- **Discriminated unions** (`ok | soft_fail | hard_fail`) fit nicely for A2A message kinds
- **Trading-architect peer package** is the reference implementation for the new coordination package shape
- **`origin/apt` remote branch** lane exists for the `coastal-ai-bootstrap` `.deb`
- **`hardware-scan`** with `recommendModels()` already exists — extend to detect BC-250 (gfx1013) specifically

---

## Key reference repos (from user's CoastalCrypto stars)

| Repo | Purpose |
|---|---|
| `TechMakesArt/llama.cpp-bc250` | Vulkan inference for BC-250 (gfx1013). Primary Phase 0 candidate. |
| `Kaden-Schutt/hipfire` | RDNA-native inference engine in Rust. Phase 0 fallback if llama.cpp-bc250 is stale. |
| `a2aproject/A2A` | Agent2Agent open protocol — adopt for wire format. |
| `NousResearch/hermes-agent` | Tenacity (v0.13 durable Kanban) + Curator (v0.12 autonomous skill grading) reference. |
| `humanlayer/12-factor-agents` | Architectural guidance for production agent systems. |
| `ruvnet/ruflo` | Multi-agent swarm orchestration plugin already installed locally — patterns worth cross-referencing. |
| `thedotmack/claude-mem` | Cross-session memory compression — relevant for Phase 4 notes-substrate replication. |
| `MemPalace/mempalace` | Benchmarked memory layer — same. |

---

## Quick reference

(Filled in incrementally as Phase 1 scaffolding lands. Empty until then.)

```bash
# Phase 1 scaffolding (placeholders)
cd packages/coordination && pnpm install
cd packages/coordination && pnpm test
cd packages/coordination && npx tsc --noEmit

# Phase 0 benchmark (placeholder until script lands)
ssh bc250-node1 'coastal-bench --model qwen2.5-coder-7b-q4 --input 2048 --output 512'
```

---

## Memory note for next session

The auto-memory at `C:\Users\John\.claude\projects\C--Users-John\memory\project_coastal_multi_agent_os.md` was updated 2026-05-26 to capture the multi-agent OS vision, hardware target, role map, phase plan, and open decisions. The old `project_coastal_ai_v150.md` was superseded in the index (file may still exist as historical record).

When picking up next session:

1. Read this handoff first — it's authoritative for the multi-agent OS direction.
2. Read `2026-05-12-master-state-and-next-steps.md` for the still-valid v1.7-dev baseline.
3. Check `TaskList` for current Phase 1 / Phase 0 prep status (tasks 1–11 created 2026-05-25/26).
4. The user has been concise in this thread — match that energy; prefer terse status updates over verbose narration.
