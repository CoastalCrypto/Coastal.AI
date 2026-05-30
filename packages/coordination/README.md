# @coastal-ai/coordination

Multi-agent coordination layer for Coastal.AI. Provides a durable task board,
A2A message envelopes, and the contract every agent in a Coastal.AI swarm
codes against.

This is an **opt-in peer package** in the spirit of `@coastal-ai/trading-architect`.
Single-agent installs don't need it; importing it from a daemon enables the
coordination kinds (`task`, `handoff`, `heartbeat`) on the core notes substrate.

> Design rationale + phase plan: [`docs/handoff/2026-05-26-multi-agent-os-plan.md`](../../docs/handoff/2026-05-26-multi-agent-os-plan.md)

## The super-option contract

Three tables, six-state lifecycle, separate audit log, dependency graph:

- **Task** — the work itself. States: `queued | claimed | blocked | done | failed | cancelled`.
- **TaskClaim** — append-only audit log of who held what when. Handoff = INSERT new + UPDATE old, atomic.
- **TaskDependency** — directed edges. Two kinds: `must_complete` (blocks until dep done) and `must_not_fail` (cascades cancellation on dep failure).

See [`src/types.ts`](./src/types.ts) for the full TypeScript contract.

## A2A wire envelope

Every inter-agent message is an `A2AMessage` — a versioned, Ed25519-signed envelope.
Eight message kinds cover task lifecycle (`task.claim`, `task.heartbeat`,
`task.complete`, `task.handoff`, `task.cancel`, `task.observe`) plus agent
lifecycle (`agent.hello`, `agent.goodbye`).

Identity is a per-node Ed25519 keypair generated on first boot and persisted to
disk (see [`src/types.ts`](./src/types.ts) — `AgentIdentity`).

## Status

| Phase 1 task | Status | Surface |
|---|---|---|
| #2  Scaffold | ✅ done | `package.json`, `tsconfig`, `vitest`, `src/types.ts`, `src/index.ts` |
| #3  Task store | pending | `src/store/*` |
| #4  A2A transport + identity | pending | `src/transport/*`, `src/identity/keypair.ts` |
| #10 Dependency resolver | pending | `src/resolver/dependency-resolver.ts` |
| #5  Two-daemon localhost handoff | pending | `src/daemon.ts` + e2e test |

## How to opt in (from another package)

```ts
import {
  type Task, type TaskClaim, type A2AMessage,
  TASK_STATES, A2A_MESSAGE_KINDS,
} from '@coastal-ai/coordination'
```

The import side-effect registers the coordination kinds. To opt out, don't import.

## Reference

- A2A protocol: [`a2aproject/A2A`](https://github.com/a2aproject/A2A)
- Tenacity pattern (durable Kanban): Hermes Agent v0.13 release notes
- Sibling peer package (the shape this one mirrors): [`@coastal-ai/trading-architect`](../trading-architect/)
