import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type Database from 'better-sqlite3'
import { eventBus } from '../../events/bus.js'
import type { AgentEvent } from '../../events/types.js'
import type { AgentRegistry } from '../../agents/registry.js'
import type { ChannelManager } from '../../channels/manager.js'
import { findSuggestedToolEdges } from '../../agents/co-activation.js'
import { EdgeFeedbackStore, feedbackMultiplier } from '../../agents/edge-feedback.js'
import type { PipelineStore } from '../../pipeline/store.js'

const TOOL_EDGE_DEFAULT_WEIGHT = 0.18  // unused tools still visible but faint
const NON_TOOL_EDGE_WEIGHT = 0.5       // agent→model and agent→channel are config edges
const RECENCY_HALF_LIFE_DAYS = 14      // weight halves every 14 days of inactivity

/** Starting weight for a declared-but-never-run agent→agent handoff.
 *  A bit heavier than the default tool edge since handoffs are intentional. */
const AGENT_AGENT_BASE_WEIGHT = 0.45

/**
 * Build a per-(agent, tool) usage map from the action_log.
 * Returns count and last-use timestamp so the caller can compute a
 * recency-decayed weight. Returns an empty map if the table doesn't exist
 * yet (fresh install).
 */
function readToolEdgeUsage(db: Database.Database): Map<string, { count: number; lastAt: number }> {
  const usage = new Map<string, { count: number; lastAt: number }>()
  try {
    const rows = db.prepare(`
      SELECT agent_id, tool_name, COUNT(*) AS cnt, MAX(created_at) AS last_at
      FROM action_log
      GROUP BY agent_id, tool_name
    `).all() as Array<{ agent_id: string; tool_name: string; cnt: number; last_at: number }>
    for (const r of rows) {
      usage.set(`${r.agent_id}->tool:${r.tool_name}`, { count: r.cnt, lastAt: r.last_at })
    }
  } catch { /* fresh install — table not yet created */ }
  return usage
}

/**
 * Compute an edge's weight in [WEIGHT_FLOOR, 1] from its raw use count and
 * the most globally-active edge's count. Recency decays exponentially with
 * a 14-day half-life so dormant connections fade visually without vanishing.
 * User feedback (thumbs) applies a bounded multiplier so reinforcement
 * shapes the visualization without ever annihilating real usage.
 */
function computeEdgeWeight(count: number, lastAt: number, maxCount: number, now: number, feedbackScore = 0): number {
  let base: number
  if (count === 0 || maxCount === 0) {
    base = TOOL_EDGE_DEFAULT_WEIGHT
  } else {
    // Log-normalized so a few highly-used edges don't crush the long tail
    const useScore = Math.log(1 + count) / Math.log(1 + maxCount)
    const ageDays = (now - lastAt) / (1000 * 60 * 60 * 24)
    const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
    base = useScore * 0.6 + recency * 0.4
  }
  const adjusted = base * feedbackMultiplier(feedbackScore)
  return Math.max(TOOL_EDGE_DEFAULT_WEIGHT, Math.min(1, adjusted))
}

/**
 * Classify a tool name into a reaction "kind" so the canvas can choose a
 * color and strobe speed. Keeping the taxonomy small on purpose — the
 * unified-pulse grammar relies on only a handful of distinctions.
 */
function reactionKindFromTool(toolName: string): 'memory' | 'skill' | 'handoff' | 'search' | 'tool' {
  if (toolName.startsWith('memory_') || toolName === 'recall' || toolName === 'remember') return 'memory'
  if (toolName.startsWith('search') || toolName === 'http_get' || toolName === 'query_db') return 'search'
  if (toolName.startsWith('skill_') || toolName === 'invoke_skill' || toolName === 'run_skill') return 'skill'
  if (toolName === 'delegate' || toolName === 'ask_agent' || toolName === 'handoff' || toolName.startsWith('agent_')) return 'handoff'
  return 'tool'
}

// Translate internal agent events to graph events. Returns zero or more
// outbound events — one internal tick can fan out into multiple UI signals
// (status change + reaction pulse).
function toGraphEvents(event: AgentEvent): Array<Record<string, unknown>> {
  if (event.type === 'session_start') {
    return [
      { type: 'node_status', nodeId: event.agentId, status: 'thinking' },
      { type: 'agent_reaction', ts: event.ts, agentId: event.agentId, kind: 'think', intensity: 0.6, duration: 2000 },
    ]
  }
  if (event.type === 'session_complete') {
    return [{ type: 'node_status', nodeId: event.agentId, status: 'idle' }]
  }
  if (event.type === 'tool_call_start') {
    const kind = reactionKindFromTool(event.toolName)
    return [
      { type: 'node_status', nodeId: event.agentId, status: 'executing' },
      { type: 'agent_reaction', ts: event.ts, agentId: event.agentId, kind, intensity: 1, duration: 1800, toolName: event.toolName },
    ]
  }
  if (event.type === 'tool_call_end') {
    return [{ type: 'node_status', nodeId: event.agentId, status: 'idle' }]
  }
  if (event.type === 'graph_edge') {
    return [{ type: 'graph_edge', ts: Date.now(), source: event.source, target: event.target, edgeType: event.edgeType }]
  }
  if (event.type === 'edge_weight_update') {
    return [{ type: 'edge_weight_update', ts: event.ts, edgeId: event.edgeId, weight: event.weight, feedbackScore: event.feedbackScore }]
  }
  return []
}

function categorizeTool(t: string): string {
  return t.startsWith('memory_') ? 'Memory'
    : t.startsWith('git_') ? 'Git'
    : t === 'run_command' ? 'Shell'
    : t === 'query_db' ? 'Database'
    : t === 'http_get' ? 'Web'
    : t.includes('_') ? 'MCP' : 'File'
}

/**
 * Extract declared agent→agent handoffs from saved pipelines: every pair of
 * consecutive stages with different agent ids counts as a "flow" relationship.
 * Same-agent consecutive stages (rare but legal) are skipped since they'd just
 * loop back onto the same node. Returns per-pair counts so heavily-repeated
 * handoffs (in multiple saved pipelines) render thicker.
 */
function readAgentAgentEdges(pipelineStore?: PipelineStore): Map<string, { count: number; lastUsedAt: number | null }> {
  const out = new Map<string, { count: number; lastUsedAt: number | null }>()
  if (!pipelineStore) return out
  try {
    for (const p of pipelineStore.list()) {
      for (let i = 0; i < p.stages.length - 1; i++) {
        const a = p.stages[i].agentId
        const b = p.stages[i + 1].agentId
        if (!a || !b || a === b) continue
        const key = `${a}=>${b}`
        const existing = out.get(key)
        out.set(key, {
          count: (existing?.count ?? 0) + 1,
          lastUsedAt: Math.max(existing?.lastUsedAt ?? 0, p.updatedAt) || p.updatedAt,
        })
      }
    }
  } catch { /* no pipelines table on fresh install */ }
  return out
}

function buildSnapshot(
  registry: AgentRegistry,
  channelManager: ChannelManager,
  db: Database.Database,
  feedbackStore: EdgeFeedbackStore,
  pipelineStore?: PipelineStore,
) {
  const allAgents = registry.listAll()
  const channels = channelManager.list()
  const now = Date.now()
  const usage = readToolEdgeUsage(db)
  const maxCount = Array.from(usage.values()).reduce((m, v) => Math.max(m, v.count), 0)
  const feedback = feedbackStore.getAll()

  // Collect unique tools and models across all active agents
  const toolSet = new Map<string, { label: string; category: string }>()
  const modelSet = new Map<string, string>() // id → display name

  for (const a of allAgents) {
    for (const t of a.tools) {
      if (!toolSet.has(t)) toolSet.set(t, { label: t, category: categorizeTool(t) })
    }
    if (a.modelPref) modelSet.set(a.modelPref, a.modelPref)
  }
  if (modelSet.size === 0) modelSet.set('ollama:default', 'Ollama (default)')

  // Mine co-activation patterns: suggested growth edges to tools the agent
  // doesn't have but other agents pair with the agent's existing tools.
  const suggestions = findSuggestedToolEdges(db, allAgents.map(a => ({ id: a.id, tools: a.tools })))
  // Suggested tools may not exist as nodes yet — add them so the suggested
  // tendril has something to terminate at.
  for (const s of suggestions) {
    if (!toolSet.has(s.toolName)) toolSet.set(s.toolName, { label: s.toolName, category: categorizeTool(s.toolName) })
  }

  // Build nodes (without positions, let frontend handle layout)
  const agentNodes = allAgents.map((a) => ({
    id: a.id,
    label: a.name,
    role: a.role,
    status: a.active ? 'idle' : 'offline',
    toolsCount: a.tools.length,
    nodeType: 'agent' as const,
  }))

  const toolNodes = Array.from(toolSet.entries()).map(([id, t]) => ({
    id: `tool:${id}`,
    label: t.label,
    role: t.category,
    status: 'idle' as const,
    toolsCount: 0,
    nodeType: 'tool' as const,
  }))

  const modelNodes = Array.from(modelSet.entries()).map(([id, name]) => ({
    id: `model:${id}`,
    label: name,
    role: 'Model',
    status: 'idle' as const,
    toolsCount: 0,
    nodeType: 'model' as const,
  }))

  const channelNodes = channels.map((c) => ({
    id: `channel:${c.id}`,
    label: c.name,
    role: c.type,
    status: (c.enabled ? 'idle' : 'offline') as 'idle' | 'offline',
    toolsCount: 0,
    nodeType: 'channel' as const,
  }))

  // Build edges with weights derived from actual interaction history.
  // agent→tool weights come from action_log aggregates; agent→model/channel
  // are configuration edges and get a fixed mid weight so they always render.
  const edges: Array<{
    id: string; source: string; target: string; label: string; active: boolean;
    edgeType: string; weight: number; lastUsedAt: number | null;
    suggested?: boolean; suggestionScore?: number; suggestionPairedWith?: string;
  }> = []

  for (const a of allAgents) {
    // Agent → tools
    for (const t of a.tools) {
      const id = `${a.id}->tool:${t}`
      const u = usage.get(id)
      const fb = feedback.get(id)?.score ?? 0
      const weight = computeEdgeWeight(u?.count ?? 0, u?.lastAt ?? 0, maxCount, now, fb)
      edges.push({
        id, source: a.id, target: `tool:${t}`,
        label: 'uses', active: false, edgeType: 'agent-tool',
        weight,
        lastUsedAt: u?.lastAt ?? null,
      })
    }
    // Agent → model
    const modelId = a.modelPref ? `model:${a.modelPref}` : 'model:ollama:default'
    if (modelSet.has(a.modelPref ?? '') || !a.modelPref) {
      edges.push({
        id: `${a.id}->${modelId}`, source: a.id, target: modelId,
        label: 'runs on', active: false, edgeType: 'agent-model',
        weight: NON_TOOL_EDGE_WEIGHT, lastUsedAt: null,
      })
    }
    // Agent → channels (active agents broadcast to all enabled channels)
    if (a.active) {
      for (const c of channels) {
        if (c.enabled) {
          edges.push({
            id: `${a.id}->channel:${c.id}`, source: a.id, target: `channel:${c.id}`,
            label: 'outputs to', active: false, edgeType: 'agent-channel',
            weight: NON_TOOL_EDGE_WEIGHT, lastUsedAt: null,
          })
        }
      }
    }
  }

  // Agent → agent handoff edges from saved pipelines. These render as
  // warm coral tendrils and pulse bidirectionally during live pipeline
  // runs (stage handoffs). Count across pipelines scales the weight so
  // frequently-reused handoff pairs read as stronger collaborations.
  const agentAgent = readAgentAgentEdges(pipelineStore)
  const agentIds = new Set(allAgents.map(a => a.id))
  const maxAgentAgentCount = Array.from(agentAgent.values()).reduce((m, v) => Math.max(m, v.count), 0)
  for (const [key, info] of agentAgent) {
    const [source, target] = key.split('=>')
    // Skip if either endpoint isn't an active agent (dangling configs)
    if (!agentIds.has(source) || !agentIds.has(target)) continue
    const boost = maxAgentAgentCount > 0
      ? Math.log(1 + info.count) / Math.log(1 + maxAgentAgentCount)
      : 0
    edges.push({
      id: `${source}=>${target}`,
      source, target,
      label: 'hands off',
      active: false,
      edgeType: 'agent-agent',
      weight: Math.max(AGENT_AGENT_BASE_WEIGHT, Math.min(1, AGENT_AGENT_BASE_WEIGHT + boost * 0.4)),
      lastUsedAt: info.lastUsedAt,
    })
  }

  // Suggested growth tendrils — agent → tool the agent doesn't yet have
  for (const s of suggestions) {
    edges.push({
      id: `${s.agentId}~>tool:${s.toolName}`,
      source: s.agentId,
      target: `tool:${s.toolName}`,
      label: 'could grow',
      active: false,
      edgeType: 'agent-tool',
      weight: s.score,
      lastUsedAt: null,
      suggested: true,
      suggestionScore: s.score,
      suggestionPairedWith: s.pairedWith,
    })
  }

  return {
    nodes: [...agentNodes, ...toolNodes, ...modelNodes, ...channelNodes],
    edges,
  }
}

export async function agentEventsRoute(
  app: FastifyInstance,
  opts: {
    registry: AgentRegistry
    channelManager: ChannelManager
    db: Database.Database
    feedbackStore: EdgeFeedbackStore
    pipelineStore?: PipelineStore
    validateSession: (token: string) => boolean
  }
) {
  // Thumbs feedback on a (agent, tool) edge — closes the learning loop.
  // Reinforced edges thicken; rejected edges fade. The bounded multiplier
  // guarantees feedback shapes the visualization without ever erasing
  // actual usage history.
  app.post<{
    Params: { agentId: string; toolName: string }
    Body: { value: 1 | -1 }
  }>('/api/admin/agents/:agentId/tools/:toolName/feedback', async (req, reply) => {
    const { agentId, toolName } = req.params
    const { value } = req.body ?? { value: 0 as 1 | -1 }
    if (value !== 1 && value !== -1) {
      return reply.status(400).send({ error: 'value must be 1 or -1' })
    }

    const newScore = opts.feedbackStore.vote(agentId, toolName, value)

    // Recompute that single edge's weight and broadcast so connected
    // clients update the tendril live without a full snapshot refetch.
    const usage = readToolEdgeUsage(opts.db)
    const maxCount = Array.from(usage.values()).reduce((m, v) => Math.max(m, v.count), 0)
    const edgeId = `${agentId}->tool:${toolName}`
    const u = usage.get(edgeId)
    const weight = computeEdgeWeight(u?.count ?? 0, u?.lastAt ?? 0, maxCount, Date.now(), newScore)

    eventBus.publish({
      type: 'edge_weight_update',
      ts: Date.now(),
      edgeId,
      weight,
      feedbackScore: newScore,
    })

    return { agentId, toolName, score: newScore, weight }
  })

  // @fastify/websocket v9+ passes the raw ws WebSocket directly as the
  // handler's first argument (the v8-era SocketStream wrapper was removed).
  app.get('/ws/agent-events', { websocket: true }, (socket: WebSocket, req) => {
    let authenticated = false

    // Check header/query auth (backwards compat)
    const sessionHeader = req.headers['x-admin-session']
    const headerToken = typeof sessionHeader === 'string' ? sessionHeader : (Array.isArray(sessionHeader) ? sessionHeader[0] : '')
    const queryToken = (req.query as Record<string, string>)?.token ?? ''
    const immediateToken = headerToken || queryToken

    if (immediateToken && opts.validateSession(immediateToken)) {
      authenticated = true
    }

    // Accept auth via first message (preferred — avoids token in server logs)
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        console.warn('[ws/agent-events] 1008 Unauthorized — no auth received within timeout')
        socket.close(1008, 'Unauthorized')
      }
    }, 5000)

    const initConnection = () => {
      clearTimeout(authTimeout)
      // Send initial state with full graph
      if (socket.readyState === socket.OPEN) {
        const snapshot = buildSnapshot(opts.registry, opts.channelManager, opts.db, opts.feedbackStore, opts.pipelineStore)
        socket.send(JSON.stringify({ type: 'snapshot', ...snapshot }))
      }
    }

    // Handle first-message auth
    socket.once('message', (raw: Buffer | string) => {
      if (authenticated) return // already authed via header/query
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
        if (msg.type === 'auth' && msg.token && opts.validateSession(msg.token)) {
          authenticated = true
          initConnection()
        } else {
          socket.close(1008, 'Unauthorized')
        }
      } catch {
        socket.close(1008, 'Unauthorized')
      }
    })

    // If already authenticated via header/query, init immediately
    if (authenticated) {
      initConnection()
    }

    // Ping-pong keepalive
    const pingInterval = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30_000)

    // Per-run last-stage tracking so we can emit agent→agent graph_edge
    // events the moment one agent hands off work to another. Scoped to
    // this socket so one client's runs don't leak across connections.
    const lastStageAgentByRun = new Map<string, string>()

    // Subscribe to agent events
    const listener = (event: AgentEvent) => {
      if (socket.readyState !== socket.OPEN) return
      for (const outbound of toGraphEvents(event)) {
        socket.send(JSON.stringify(outbound))
      }

      // Derive live agent→agent handoff edges from consecutive stages of
      // the same run. stage_end records the outgoing agent; the next
      // stage_start names the incoming agent — if different, that's a
      // handoff worth pulsing.
      if (event.type === 'stage_end') {
        lastStageAgentByRun.set(event.runId, event.agentId)
      } else if (event.type === 'stage_start') {
        const prev = lastStageAgentByRun.get(event.runId)
        if (prev && prev !== event.agentId) {
          socket.send(JSON.stringify({
            type: 'graph_edge',
            ts: event.ts,
            source: prev,
            target: event.agentId,
            edgeType: 'agent-agent',
          }))
        }
      } else if (event.type === 'pipeline_done' || event.type === 'pipeline_error') {
        lastStageAgentByRun.delete(event.runId)
      }
    }

    eventBus.onAgent(listener)

    socket.on('close', () => {
      clearInterval(pingInterval)
      eventBus.offAgent(listener)
      lastStageAgentByRun.clear()
    })

    socket.on('error', () => {
      socket.close()
    })
  })
}
