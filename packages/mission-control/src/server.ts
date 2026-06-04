// packages/mission-control/src/server.ts
//
// Plain node:http server. Zero external HTTP deps so this package can
// run in any v0.0.x environment without imposing a framework choice.
//
// Endpoints:
//   GET  /api/tasks               — paged list, query filters
//   GET  /api/tasks/:id           — detail + claim history
//   GET  /api/agents              — known peer agents
//   GET  /api/events              — SSE stream of live A2A broadcasts
//   POST /api/tasks               — submit a new task via daemon.submit
//   GET  /api/health              — liveness probe
//
// Auth: optional Bearer token. Loopback‑only by default (bindAddress
// 127.0.0.1) so the auth layer is for when the operator binds to a
// non‑loopback interface.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type {
  MissionControlConfig, MissionControl,
  ErrorBody, TaskFilter,
  TasksListResponse, TaskDetailResponse, AgentsListResponse, AgentInfo,
} from './types.js'
import type { A2AMessage, Task, TaskClaim, TaskState } from '@coastal-ai/coordination'

// Resolve the dashboard's location relative to this module. Works at
// both source (vitest/tsx) and dist (compiled) — the build step copies
// the static/ tree into dist/static/.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DASHBOARD_PATH = join(__dirname, 'static', 'dashboard.html')

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 50

export function createMissionControl(config: MissionControlConfig): Promise<MissionControl> {
  const {
    db, port = 0, bindAddress = '127.0.0.1',
    subscribe, submit, peerRegistry, authToken, corsOrigins = [],
  } = config

  // ── SSE state ───────────────────────────────────────────────────────

  type SseClient = {
    res: ServerResponse
    heartbeat: NodeJS.Timeout
  }
  const sseClients = new Set<SseClient>()

  const unsubscribeFromBus = subscribe((msg: A2AMessage) => {
    fanout(sseClients, msg)
  })

  // ── helpers ────────────────────────────────────────────────────────

  function checkAuth(req: IncomingMessage): boolean {
    if (!authToken) return true
    const header = req.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    return header.slice(7) === authToken
  }

  function applyCors(res: ServerResponse, origin: string | undefined): void {
    if (corsOrigins.length === 0) return
    const allowed = corsOrigins.includes('*')
      ? '*'
      : (origin && corsOrigins.includes(origin) ? origin : null)
    if (allowed) {
      res.setHeader('access-control-allow-origin', allowed)
      res.setHeader('access-control-allow-headers', 'authorization, content-type')
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    }
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  function sendError(res: ServerResponse, status: number, error: string, message: string): void {
    const body: ErrorBody = { error, message, status }
    sendJson(res, status, body)
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let buf = ''
      req.setEncoding('utf8')
      req.on('data', chunk => { buf += chunk })
      req.on('end', () => {
        if (!buf) { resolve(null); return }
        try { resolve(JSON.parse(buf)) } catch (e) { reject(e) }
      })
      req.on('error', reject)
    })
  }

  // ── route handlers ─────────────────────────────────────────────────

  function handleTasksList(_req: IncomingMessage, res: ServerResponse, url: URL): void {
    const filter = parseTaskFilter(url)
    const { tasks, total } = listTasks(db, filter)
    const body: TasksListResponse = { tasks, total }
    sendJson(res, 200, body)
  }

  function handleTaskDetail(_req: IncomingMessage, res: ServerResponse, id: string): void {
    const task = getTask(db, id)
    if (!task) {
      sendError(res, 404, 'not_found', `task ${id} not found`)
      return
    }
    const claims = getClaims(db, id)
    const body: TaskDetailResponse = { task, claims }
    sendJson(res, 200, body)
  }

  function handleAgents(_req: IncomingMessage, res: ServerResponse): void {
    const agents: AgentInfo[] = []
    if (peerRegistry) {
      for (const agentId of peerRegistry.list()) {
        const pk = peerRegistry.get(agentId) ?? ''
        agents.push({
          agentId,
          publicKeyShort: pk ? createHash('sha256').update(pk).digest('hex').slice(0, 16) : '',
        })
      }
    }
    const body: AgentsListResponse = { agents }
    sendJson(res, 200, body)
  }

  function handleSseEvents(_req: IncomingMessage, res: ServerResponse): SseClient {
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream')
    res.setHeader('cache-control', 'no-cache')
    res.setHeader('connection', 'keep-alive')
    res.write(`retry: 2000\n\n`)
    // Heartbeat every 30s keeps proxies / browsers from idling out
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat\n\n`) } catch { /* socket closed */ }
    }, 30_000)
    heartbeat.unref()
    return { res, heartbeat }
  }

  async function handleTaskSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown
    try { body = await readBody(req) } catch {
      sendError(res, 400, 'invalid_json', 'request body is not valid JSON')
      return
    }
    if (!body || typeof body !== 'object') {
      sendError(res, 400, 'invalid_request', 'body must be an object')
      return
    }
    const { kind, payload, maxRetries, parentTaskId } = body as Record<string, unknown>
    if (typeof kind !== 'string' || !kind) {
      sendError(res, 400, 'invalid_request', 'body.kind is required')
      return
    }
    try {
      const task = await submit({
        kind,
        payload,
        maxRetries: typeof maxRetries === 'number' ? maxRetries : undefined,
        parentTaskId: typeof parentTaskId === 'string' ? parentTaskId : null,
      })
      sendJson(res, 201, { task })
    } catch (err) {
      sendError(res, 500, 'submit_failed', (err as Error).message)
    }
  }

  // ── dispatch ───────────────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    try {
      applyCors(res, req.headers.origin as string | undefined)
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

      if (url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      // Serve the dashboard at / — public, no auth (the API endpoints
      // it calls will be auth-checked individually).
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        if (existsSync(DASHBOARD_PATH)) {
          const html = readFileSync(DASHBOARD_PATH, 'utf8')
          res.statusCode = 200
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(html)
        } else {
          res.statusCode = 200
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(`<!doctype html><html><body>
<h1>Coastal.AI Mission Control</h1>
<p>Dashboard asset missing at ${DASHBOARD_PATH}. The package was likely built without copying src/static/ into dist/static/. API still works at /api/*.</p>
</body></html>`)
        }
        return
      }

      if (!checkAuth(req)) {
        sendError(res, 401, 'unauthorized', 'missing or invalid bearer token')
        return
      }

      // Routing
      if (req.method === 'GET' && url.pathname === '/api/tasks') {
        handleTasksList(req, res, url); return
      }
      const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/)
      if (req.method === 'GET' && taskDetailMatch) {
        handleTaskDetail(req, res, taskDetailMatch[1]); return
      }
      if (req.method === 'GET' && url.pathname === '/api/agents') {
        handleAgents(req, res); return
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const client = handleSseEvents(req, res)
        sseClients.add(client)
        req.on('close', () => {
          clearInterval(client.heartbeat)
          sseClients.delete(client)
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/tasks') {
        await handleTaskSubmit(req, res); return
      }
      sendError(res, 404, 'not_found', `no route for ${req.method} ${url.pathname}`)
    } catch (err) {
      sendError(res, 500, 'internal_error', (err as Error).message)
    }
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, bindAddress, () => {
      const addr = server.address()
      if (typeof addr === 'string' || !addr) {
        reject(new Error('mission-control: failed to bind'))
        return
      }
      const boundPort = addr.port
      resolve({
        port: () => boundPort,
        async stop() {
          unsubscribeFromBus()
          for (const c of sseClients) {
            clearInterval(c.heartbeat)
            try { c.res.end() } catch { /* swallow */ }
          }
          sseClients.clear()
          await new Promise<void>(r => server.close(() => r()))
        },
      })
    })
  })
}

// ─── SSE fanout ────────────────────────────────────────────────────

function fanout(
  clients: ReadonlySet<{ res: ServerResponse }>,
  msg: A2AMessage,
): void {
  if (clients.size === 0) return
  // Only forward state-change kinds — heartbeats and observation
  // messages don't belong in the UI's event stream.
  const interesting = isStateChangeKind(msg.kind)
  if (!interesting) return
  const payload = JSON.stringify({
    kind: msg.kind,
    from: msg.from.agentId,
    timestamp: msg.timestamp,
    payload: msg.payload,
  })
  const frame = `event: a2a\ndata: ${payload}\n\n`
  for (const client of clients) {
    try { client.res.write(frame) } catch { /* socket closed */ }
  }
}

function isStateChangeKind(kind: string): boolean {
  return kind === 'task.available'
    || kind === 'task.claim'
    || kind === 'task.complete'
    || kind === 'task.handoff'
    || kind === 'task.cancel'
    || kind === 'task.requeued'
    || kind === 'agent.hello'
    || kind === 'agent.goodbye'
}

// ─── DB helpers (direct SQL — mission-control is read‑mostly) ──────

function parseTaskFilter(url: URL): TaskFilter {
  const params = url.searchParams
  const state = params.getAll('state').filter(Boolean) as TaskState[]
  const limit = Math.min(
    Math.max(parseInt(params.get('limit') ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )
  const offset = Math.max(parseInt(params.get('offset') ?? '0', 10) || 0, 0)
  return {
    state: state.length === 0 ? undefined : state.length === 1 ? state[0] : state,
    kind: params.get('kind') ?? undefined,
    ownerAgentId: params.get('owner') ?? undefined,
    limit,
    offset,
  }
}

function listTasks(db: Database.Database, filter: TaskFilter): { tasks: Task[]; total: number } {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.state !== undefined) {
    const states = Array.isArray(filter.state) ? filter.state : [filter.state]
    const placeholders = states.map(() => '?').join(',')
    where.push(`state IN (${placeholders})`)
    params.push(...states)
  }
  if (filter.kind) { where.push('kind = ?'); params.push(filter.kind) }
  if (filter.ownerAgentId) { where.push('owner_agent_id = ?'); params.push(filter.ownerAgentId) }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = filter.limit ?? DEFAULT_LIMIT
  const offset = filter.offset ?? 0
  const totalRow = db.prepare(`SELECT COUNT(*) as n FROM tasks ${whereSql}`).get(...params) as { n: number }
  const rows = db.prepare(
    `SELECT * FROM tasks ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as TaskRow[]
  return { tasks: rows.map(rowToTask), total: totalRow.n }
}

function getTask(db: Database.Database, id: string): Task | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

function getClaims(db: Database.Database, taskId: string): TaskClaim[] {
  const rows = db.prepare(
    `SELECT * FROM task_claims WHERE task_id = ? ORDER BY claimed_at ASC`,
  ).all(taskId) as ClaimRow[]
  return rows.map(rowToClaim)
}

interface TaskRow {
  id: string; state: string; kind: string; payload: string;
  result: string | null; failure_reason: string | null;
  owner_agent_id: string | null; retry_count: number; max_retries: number;
  created_at: number; updated_at: number; parent_task_id: string | null;
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id, state: r.state as Task['state'], kind: r.kind,
    payload: JSON.parse(r.payload),
    result: r.result === null ? null : JSON.parse(r.result),
    failureReason: r.failure_reason,
    ownerAgentId: r.owner_agent_id,
    retryCount: r.retry_count, maxRetries: r.max_retries,
    createdAt: r.created_at, updatedAt: r.updated_at,
    parentTaskId: r.parent_task_id,
  }
}

interface ClaimRow {
  id: string; task_id: string; agent_id: string;
  claimed_at: number; last_heartbeat: number;
  released_at: number | null; release_reason: string | null;
  handoff_to_agent_id: string | null;
}

function rowToClaim(r: ClaimRow): TaskClaim {
  return {
    id: r.id, taskId: r.task_id, agentId: r.agent_id,
    claimedAt: r.claimed_at, lastHeartbeat: r.last_heartbeat,
    releasedAt: r.released_at,
    releaseReason: r.release_reason as TaskClaim['releaseReason'],
    handoffToAgentId: r.handoff_to_agent_id,
  }
}
