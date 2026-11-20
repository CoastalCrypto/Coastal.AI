// packages/core/src/api/auth-policy.ts
//
// The single source of truth for "who may call what". Replaces the
// isNetworkExposed conditional in server.ts's onRequest hook, which only
// required auth once the server left loopback — leaving every route open on
// any localhost-bound install, including /api/pipeline/run and
// /api/team/run, both of which execute agents with shell/filesystem tools
// at the configured trust level.
//
// Posture: DENY BY DEFAULT, at every bind address, including loopback. A
// route is reachable with no session only if it appears in PUBLIC_ROUTES.
// Every other route needs a valid session; ROUTE_RULES assigns the minimum
// role, falling through to DEFAULT_REQUIRED_ROLE when nothing matches — that
// fallback is the actual security property here, not the rules list.

import type { UserRole } from '../users/store.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Routes reachable with no credentials at all. Deliberately tiny — these are
 * the routes a client needs before it can possibly hold a session, plus one
 * cryptographically-gated exception (see the comment on architect/callbacks
 * below). Matched as exact paths or prefixes — see `isPublicRoute`.
 */
export const PUBLIC_ROUTES = [
  '/health', // healthRoutes mounts at /health, not /api/health
  '/api/version',
  '/api/auth/login',
  '/api/auth/setup',

  // Validate their own session token directly from the header inside the
  // handler (see users.ts) rather than relying on this hook — and must stay
  // reachable even when checkSessionAuth would otherwise block the caller
  // for mustChangePassword, since changing that password is exactly what
  // /api/auth/password exists to let them do.
  '/api/auth/me',
  '/api/auth/password',

  // Clicked from a Telegram/email link by a human who holds no session —
  // the token itself is the credential. verifyCallbackToken (see
  // architect/verify-callback-token.ts) does HMAC-SHA256 verification with
  // constant-time compare and an expiry check; a session check here would
  // be redundant with that, not additive to it.
  '/api/admin/architect/callbacks',
] as const

/** Role ordering for "minimum role" checks — rank >= required rank passes. */
const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
}

export function satisfiesRole(actual: UserRole, required: UserRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
}

export interface RouteRule {
  /** Path prefix this rule applies to. */
  prefix: string
  /** Minimum role a caller must hold. */
  role: UserRole
  /** Restrict this rule to specific HTTP methods; omit to match any method. */
  methods?: ReadonlyArray<HttpMethod>
}

/**
 * Minimum role per route, as ordered prefix rules — most specific prefix
 * first, since the first match wins. Anything not listed here falls through
 * to DEFAULT_REQUIRED_ROLE, i.e. is admin-only: every /api/admin/* route
 * (users, tools, MCP, crons, channels, architect controls) gets that for
 * free and needs no entry of its own.
 *
 * Two shapes of decision went into this:
 *
 *   Tool/shell execution (chat, team, pipeline run, the chat websocket) —
 *   'operator'. These are the product's core multi-user feature (the
 *   README's whole "Teams that want shared AI agents" pitch); gating them
 *   to admin would mean only one person can ever make the system do work.
 *
 *   Read vs. write on the shared memory/notes substrate (notes, search,
 *   knowledge, skills, sessions) — viewer can read, operator can write.
 *   A viewer browsing recalled notes is harmless; a viewer writing them
 *   pollutes the store every soul agent recalls from on every turn.
 */
export const ROUTE_RULES: ReadonlyArray<RouteRule> = [
  // Tool/shell execution — the product's team feature, not an admin-only one.
  { prefix: '/api/chat', role: 'operator' },
  { prefix: '/api/team', role: 'operator' },
  { prefix: '/api/upload', role: 'operator' },
  { prefix: '/ws/session', role: 'operator' },

  // Pipeline: read status at viewer, execute at operator.
  { prefix: '/api/pipeline/run', role: 'operator', methods: ['POST'] },
  { prefix: '/api/pipeline', role: 'viewer' },

  // Shared memory substrate: read at viewer, mutate at operator.
  { prefix: '/api/notes', role: 'viewer', methods: ['GET'] },
  { prefix: '/api/notes', role: 'operator' },
  { prefix: '/api/search', role: 'viewer' },
  { prefix: '/api/knowledge', role: 'viewer', methods: ['GET'] },
  { prefix: '/api/knowledge', role: 'operator' },
  { prefix: '/api/skills', role: 'viewer', methods: ['GET'] },
  { prefix: '/api/skills', role: 'operator' },

  // User-scoped, low-sensitivity: viewer can read/manage their own sessions.
  { prefix: '/api/sessions', role: 'viewer' },

  // Agent/persona config: read at viewer, reconfigure at operator.
  { prefix: '/api/persona', role: 'viewer', methods: ['GET'] },
  { prefix: '/api/persona', role: 'operator' },

  // Read-only dashboards and feeds.
  { prefix: '/api/events', role: 'viewer' },
  { prefix: '/api/analytics', role: 'viewer' },
  { prefix: '/api/system/stats', role: 'viewer' },
  { prefix: '/api/voices', role: 'viewer' },
]

/**
 * Fallback for any authenticated route no rule matched — admin. This is the
 * backstop that makes a route added in future, with nobody remembering to
 * update ROUTE_RULES, fail closed rather than fail open.
 */
export const DEFAULT_REQUIRED_ROLE: UserRole = 'admin'

/** Resolve the minimum role for a request. */
export function requiredRoleFor(method: string, pathname: string): UserRole {
  for (const rule of ROUTE_RULES) {
    if (!pathname.startsWith(rule.prefix)) continue
    if (rule.methods && !rule.methods.includes(method as HttpMethod)) continue
    return rule.role
  }
  return DEFAULT_REQUIRED_ROLE
}
