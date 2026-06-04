// packages/mission-control/src/types.ts

import type {
  Task, TaskState, TaskClaim, TaskInput, A2AMessage,
  PeerRegistry,
} from '@coastal-ai/coordination'
import type Database from 'better-sqlite3'

export interface MissionControlConfig {
  /** Port to listen on. 0 = OS picks ephemeral (recommended for tests). */
  port?: number
  /** Bind address. Default '127.0.0.1' (loopback only). */
  bindAddress?: string
  /**
   * Underlying SQLite DB to query for tasks/claims. Mission control
   * is a read‑mostly layer — write path goes through the daemon's
   * submit() so broadcasts happen normally.
   */
  db: Database.Database
  /** Read‑only access to the peer registry (TOFU pubkey map). */
  peerRegistry?: PeerRegistry
  /**
   * Subscribe function to attach to A2A broadcasts — fed into the SSE
   * event stream. Typically `transport.subscribe`.
   */
  subscribe: (handler: (msg: A2AMessage) => void) => () => void
  /**
   * Submit a task. Wired to the local daemon's `submit()` so the new
   * task broadcasts properly.
   */
  submit: (input: TaskInput) => Promise<Task>
  /**
   * Optional bearer token. When set, every API call must include
   * `Authorization: Bearer <token>`. Defaults to no auth (loopback
   * only by default, so this is OK for v0.0.x).
   */
  authToken?: string
  /**
   * Optional list of allowed CORS origins. Default: same-origin only
   * (no CORS headers). Pass `['*']` for permissive dev.
   */
  corsOrigins?: string[]
}

export interface TaskFilter {
  state?: TaskState | TaskState[]
  kind?: string
  ownerAgentId?: string
  /** Default 50; max 500. */
  limit?: number
  /** Pagination offset. */
  offset?: number
}

export interface MissionControl {
  /** Actual port the server is bound to (resolves OS-assigned). */
  port(): number
  /** Tear down — closes connections, stops SSE streams. */
  stop(): Promise<void>
}

// ─── HTTP error envelope (consistent across endpoints) ──────────────

export interface ErrorBody {
  error: string
  message: string
  status: number
}

// ─── Response shapes ────────────────────────────────────────────────

export interface TasksListResponse {
  tasks: Task[]
  total: number
}

export interface TaskDetailResponse {
  task: Task
  claims: TaskClaim[]
}

export interface AgentInfo {
  agentId: string
  publicKeyShort: string
}

export interface AgentsListResponse {
  agents: AgentInfo[]
}
