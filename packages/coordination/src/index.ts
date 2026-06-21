// packages/coordination/src/index.ts
//
// Public entry point. Re-exports the surface that consumers (daemon
// processes, REST routes, future CLI) need.
//
// IMPORTANT — side effect on import: this module registers three note
// kinds with the core kinds-registry so coordination state can ride on
// the existing v1.7 notes substrate:
//
//   'task'       — a unit of work persisted as a note for observability
//   'handoff'    — a discrete handoff event between two agents
//   'heartbeat'  — periodic liveness pulse from a claim-holding agent
//
// Coastal.AI's kernel ships without any of these — single-agent installs
// get a strictly non-coordination note set. Importing anything from this
// package (including just `import '@coastal-ai/coordination'`) opts in.

import { registerKind } from '@coastal-ai/core/memory/kinds-registry'

registerKind('task')
registerKind('handoff')
registerKind('heartbeat')

// ─── Type contracts ──────────────────────────────────────────────────

export type {
  // Task lifecycle
  TaskState, TerminalTaskState,
  Task, TaskInput, TaskPatch,
  // Claim history
  ClaimReleaseReason,
  TaskClaim, TaskClaimInput,
  // Dependency graph
  DependencyKind,
  TaskDependency, TaskDependencyInput,
  // A2A envelope
  A2AMessageKind, A2AProtocolVersion,
  A2AMessage,
  // Identity
  AgentIdentity, AgentDescriptor,
} from './types.js'

export {
  TASK_STATES, TERMINAL_TASK_STATES,
  CLAIM_RELEASE_REASONS,
  DEPENDENCY_KINDS,
  A2A_MESSAGE_KINDS, A2A_PROTOCOL_VERSION,
} from './types.js'

// ─── Store layer ─────────────────────────────────────────────────────

export { openCoordinationDb, type CoordinationDbConfig } from './store/db.js'
export { TaskStore } from './store/task-store.js'
export { ClaimStore, type ReleaseOpts } from './store/claim-store.js'
export { DependencyStore } from './store/dependency-store.js'

// ─── State machine + multi-store transitions ─────────────────────────

export {
  VALID_TRANSITIONS,
  isValidTransition,
  assertTransition,
} from './transitions/state-machine.js'

export { handoff, type HandoffDeps } from './transitions/handoff.js'
export {
  reclaimZombies,
  type ReclaimDeps, type ReclaimOpts, type ReclaimResult,
} from './transitions/reclaim.js'

// ─── Identity ────────────────────────────────────────────────────────

export {
  generateIdentity,
  loadOrCreateIdentity,
  persistIdentity,
  keyObjectsFor,
  publicKeyFromBase64,
} from './identity/keypair.js'

export {
  createPeerRegistry,
  type PeerRegistry,
  type PeerRegistryConfig,
  type VerifyResult as PeerVerifyResult,
} from './identity/peer-registry.js'

// ─── A2A transport ───────────────────────────────────────────────────

export {
  canonicalize,
  signMessage,
  verifyMessage,
  type BuildMessageInput,
  type VerifyResult,
  type VerifyOpts,
} from './transport/a2a-envelope.js'

export type { A2ATransport } from './transport/types.js'

export {
  LocalhostBus,
  createLocalhostTransport,
  type LocalhostTransportConfig,
} from './transport/localhost.js'

export {
  createTcpTransport,
  type TcpTransport,
  type TcpTransportConfig,
  type TcpPeer,
} from './transport/tcp.js'

export {
  createMdnsDiscovery,
  publicKeyShortHash,
  COASTAL_AI_MDNS_TYPE,
  COASTAL_AI_MDNS_PROTOCOL,
  type DiscoveredPeer,
  type MdnsConfig,
  type MdnsDiscovery,
} from './transport/mdns.js'

export {
  createTelegramTransport,
  A2A_WIRE_PREFIX,
  type TelegramClient,
  type TelegramOutgoing,
  type TelegramIncoming,
  type TelegramTransportConfig,
} from './transport/telegram.js'

// ─── User command router (Phase 5 human↔swarm bridge) ─────────────────

export {
  createUserCommandRouter,
  type UserCommandRouter,
  type UserCommandRouterConfig,
} from './user-commands/router.js'

// ─── Dependency resolver ─────────────────────────────────────────────

export {
  resolveDependencies,
  evaluateBlockedState,
  type ResolverDeps,
  type ResolverResult,
} from './resolver/dependency-resolver.js'

// ─── Daemon (end-to-end agent loop) ──────────────────────────────────

export {
  CoordinationDaemon,
  runCoordinationDaemon,
  type DaemonConfig,
  type WorkerContext,
} from './daemon.js'

// ─── Replication ─────────────────────────────────────────────────────

export {
  createReplicator,
  type Replicator,
  type ReplicatorConfig,
} from './replication/replicator.js'

export {
  reconcileSyncthing,
  type SyncthingHttp,
  type DesiredFolder,
  type ReconcileInput,
} from './replication/syncthing-config.js'

export {
  buildWorkerFolders,
  buildCuratorFolders,
  type PeerDevice,
} from './replication/syncthing-folders.js'

// ─── Observability (Monitor backend) ─────────────────────────────────

export {
  createOpenObserveClient,
  type OpenObserveClient,
  type OpenObserveConfig,
  type FetchLike,
} from './observability/openobserve-client.js'

export {
  evaluateHealth,
  type Heartbeat,
  type Alert,
} from './observability/health-eval.js'
