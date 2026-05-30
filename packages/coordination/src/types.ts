// packages/coordination/src/types.ts
//
// The super-option contract for multi-agent coordination, agreed 2026-05-26.
// See docs/handoff/2026-05-26-multi-agent-os-plan.md for the design rationale.
//
// Three top-level types:
//   - Task            — the work itself (6-state lifecycle, single row)
//   - TaskClaim       — append-only audit log of who held what when
//   - TaskDependency  — directed edges defining the dependency graph
//
// A2AMessage is the wire envelope every inter-agent message rides in.
//
// Pattern follows packages/core/src/memory/notes.ts: const tuples for the
// closed sets, derived types via `typeof X[number]`. Plugins can't extend
// these — coordination is core-adjacent enough that the closed sets are
// load-bearing for the protocol.

// ─── Task lifecycle ──────────────────────────────────────────────────

export const TASK_STATES = [
  'queued',     // exists in the board, ready to be claimed
  'claimed',    // someone holds an active claim (heartbeat required)
  'blocked',    // waiting on dependencies to clear
  'done',       // success — terminal
  'failed',     // retries exhausted — terminal
  'cancelled',  // killed externally — terminal
] as const
export type TaskState = typeof TASK_STATES[number]

export const TERMINAL_TASK_STATES = ['done', 'failed', 'cancelled'] as const
export type TerminalTaskState = typeof TERMINAL_TASK_STATES[number]

export interface Task {
  id: string
  state: TaskState
  /** Free-form task type, e.g. 'code', 'review', 'eval'. */
  kind: string
  /** Task-type-specific input data; opaque to the coordination layer. */
  payload: unknown
  /** Populated only when state === 'done'. */
  result: unknown | null
  /** Populated when state === 'failed' or 'cancelled'. */
  failureReason: string | null
  /**
   * Denormalized from the active claim row. Null when state === 'queued',
   * set when state === 'claimed'. Kept on the task for fast "who owns
   * this?" queries without a JOIN.
   */
  ownerAgentId: string | null
  retryCount: number
  maxRetries: number
  createdAt: number
  updatedAt: number
  /** For subtask trees. Null for top-level tasks. */
  parentTaskId: string | null
}

export interface TaskInput {
  /** Optional — store generates a ULID if omitted. */
  id?: string
  kind: string
  payload: unknown
  maxRetries?: number
  parentTaskId?: string | null
}

export interface TaskPatch {
  state?: TaskState
  result?: unknown | null
  failureReason?: string | null
  ownerAgentId?: string | null
  retryCount?: number
}

// ─── Claim history (append-only audit log) ───────────────────────────

export const CLAIM_RELEASE_REASONS = [
  'completed',  // claim released because the task finished successfully
  'handoff',    // claim released because work was passed to another agent
  'reclaimed',  // claim released because heartbeat went stale
  'cancelled',  // claim released because the task was cancelled mid-flight
] as const
export type ClaimReleaseReason = typeof CLAIM_RELEASE_REASONS[number]

export interface TaskClaim {
  id: string
  taskId: string
  agentId: string
  claimedAt: number
  /** Updated by heartbeats. Stale value → reclaim candidate. */
  lastHeartbeat: number
  /** Null while the claim is active. */
  releasedAt: number | null
  releaseReason: ClaimReleaseReason | null
  /** Populated iff releaseReason === 'handoff'. */
  handoffToAgentId: string | null
}

export interface TaskClaimInput {
  /** Optional — store generates a ULID if omitted. */
  id?: string
  taskId: string
  agentId: string
}

// ─── Dependency graph ────────────────────────────────────────────────

export const DEPENDENCY_KINDS = [
  /**
   * Dependent task stays 'blocked' until dep is 'done'. If dep enters
   * 'failed' or 'cancelled', dependent stays 'blocked' — manual revive
   * required.
   */
  'must_complete',
  /**
   * Dependent task stays 'blocked' until dep is 'done'. If dep enters
   * 'failed' or 'cancelled', dependent is auto-cancelled (cascading
   * failure).
   */
  'must_not_fail',
] as const
export type DependencyKind = typeof DEPENDENCY_KINDS[number]

export interface TaskDependency {
  taskId: string
  dependsOnTaskId: string
  kind: DependencyKind
}

export interface TaskDependencyInput {
  taskId: string
  dependsOnTaskId: string
  kind: DependencyKind
}

// ─── A2A wire envelope ───────────────────────────────────────────────

export const A2A_MESSAGE_KINDS = [
  // Task lifecycle events
  /** Broadcast by the creator: "new task is on the board, anyone interested?" */
  'task.available',
  'task.claim',
  'task.heartbeat',
  'task.complete',
  'task.handoff',
  'task.cancel',
  /**
   * Broadcast after a worker's worker function threw: the claim was
   * released with reason='reclaimed' and the task is back to 'queued'
   * with retryCount bumped. Replicators apply the full state.
   */
  'task.requeued',
  /** Read-only observation: "I'm watching this task, notify on changes." */
  'task.observe',
  // Agent lifecycle
  'agent.hello',    // sent on cluster join — announces identity + role
  'agent.goodbye',  // sent on clean shutdown — claims released, peers can reroute
] as const
export type A2AMessageKind = typeof A2A_MESSAGE_KINDS[number]

export const A2A_PROTOCOL_VERSION = '0.1' as const
export type A2AProtocolVersion = typeof A2A_PROTOCOL_VERSION

export interface A2AMessage {
  version: A2AProtocolVersion
  /** ULID — sortable by send time, globally unique. */
  messageId: string
  from: {
    agentId: string
    /** Ed25519 public key, base64-encoded. */
    publicKey: string
  }
  /** Recipient agent ID or '*' for broadcast. */
  to: string | '*'
  timestamp: number
  kind: A2AMessageKind
  /** Kind-specific payload. */
  payload: unknown
  /**
   * Ed25519 signature over canonical-JSON(message without the signature
   * field), base64-encoded. Validated by the receiver against the
   * declared from.publicKey, which itself is validated against the
   * known key for from.agentId (TOFU on first contact, locked
   * thereafter).
   */
  signature: string
}

// ─── Agent identity ──────────────────────────────────────────────────

export interface AgentIdentity {
  agentId: string
  /** Base64-encoded Ed25519 public key. */
  publicKey: string
  /**
   * Base64-encoded Ed25519 private key seed (32 bytes). Persisted to
   * disk with 0600 perms. Never crosses the wire.
   */
  privateKey: string
}

export interface AgentDescriptor {
  agentId: string
  publicKey: string
  /** Declared role from the role map (e.g. 'main', 'coder', 'curator'). */
  role: string
  /** Last-seen network address; null for local agents. */
  address: string | null
  /** Last time we received any A2A traffic from this agent. */
  lastSeen: number
}
