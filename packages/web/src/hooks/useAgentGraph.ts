import { useState, useEffect, useRef, useCallback } from 'react'
import type { AgentGraphState, AgentGraphEvent, Reaction } from '../types/agent-graph'
import { coreWsOrigin } from '../platform/coreOrigin'

const INITIAL_STATE: AgentGraphState = { nodes: [], edges: [], lastUpdated: 0 }

const ROLE_LABEL: Record<string, string> = {
  'agent-tool': 'Tool',
  'agent-model': 'Model',
  'agent-channel': 'Channel',
}

// How long an edge stays "active" (glowing) after a graph_edge event fires
const EDGE_ACTIVE_TTL_MS = 2500

// Pure reducer — exported for unit testing
export function applyEvent(state: AgentGraphState, event: AgentGraphEvent): AgentGraphState {
  switch (event.type) {
    case 'snapshot':
      return { nodes: event.nodes, edges: event.edges, lastUpdated: Date.now() }
    case 'node_status':
      return {
        ...state,
        nodes: state.nodes.map(n => n.id === event.nodeId ? { ...n, status: event.status } : n),
        lastUpdated: Date.now(),
      }
    case 'node_added':
      return { ...state, nodes: [...state.nodes, event.node], lastUpdated: Date.now() }
    case 'node_removed':
      return { ...state, nodes: state.nodes.filter(n => n.id !== event.nodeId), lastUpdated: Date.now() }
    case 'edge_added':
      return { ...state, edges: [...state.edges, event.edge], lastUpdated: Date.now() }
    case 'edge_removed':
      return { ...state, edges: state.edges.filter(e => e.id !== event.edgeId), lastUpdated: Date.now() }
    case 'edge_active':
      return {
        ...state,
        edges: state.edges.map(e => e.id === event.edgeId ? { ...e, active: event.active } : e),
        lastUpdated: Date.now(),
      }
    case 'graph_edge': {
      const edgeId = `${event.source}->${event.target}`
      const now = Date.now()

      // Upsert source node (the agent)
      const sourceExists = state.nodes.some(n => n.id === event.source)
      let nodes = sourceExists
        ? state.nodes.map(n => n.id === event.source
            ? { ...n, status: 'executing' as const, lastActivity: now }
            : n)
        : [...state.nodes, { id: event.source, label: event.source, status: 'executing' as const, role: 'Agent', toolsCount: 0, lastActivity: now }]

      // Upsert target node (tool / model / channel)
      const targetExists = nodes.some(n => n.id === event.target)
      if (!targetExists) {
        nodes = [...nodes, { id: event.target, label: event.target, status: 'idle' as const, role: ROLE_LABEL[event.edgeType] ?? 'Tool', toolsCount: 0, lastActivity: now }]
      }

      // Upsert edge — mark active so React Flow animates it
      const edgeExists = state.edges.some(e => e.id === edgeId)
      const edges = edgeExists
        ? state.edges.map(e => e.id === edgeId ? { ...e, active: true } : e)
        : [...state.edges, { id: edgeId, source: event.source, target: event.target, label: event.edgeType, active: true }]

      return { nodes, edges, lastUpdated: now }
    }
    case 'edge_weight_update':
      return {
        ...state,
        edges: state.edges.map(e => e.id === event.edgeId ? { ...e, weight: event.weight } : e),
        lastUpdated: Date.now(),
      }
    case 'ping':
      return state
    default:
      return state
  }
}

export function useAgentGraph() {
  const [state, setState] = useState<AgentGraphState>(INITIAL_STATE)
  const [connected, setConnected] = useState(false)
  // Reactions are ephemeral per-agent "currently doing" signals. We expose
  // them as a ref + version counter pattern so high-frequency reactions
  // don't trigger React re-renders on the whole graph — the canvas reads
  // them off the ref inside its rAF loop.
  const reactionsRef = useRef<Map<string, Reaction>>(new Map())
  const reactionCleanupRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const token = sessionStorage.getItem('cc_admin_session') ?? ''
    const ws = new WebSocket(`${coreWsOrigin()}/ws/agent-events`)
    wsRef.current = ws

    ws.onopen = () => {
      // Send auth token as first message instead of query string (avoids token in server logs)
      if (token) ws.send(JSON.stringify({ type: 'auth', token }))
      setConnected(true)
    }

    ws.onmessage = (e) => {
      try {
        const event: AgentGraphEvent = JSON.parse(e.data as string)

        // Reactions bypass React state — written directly to a ref the
        // canvas reads during its animation loop, so a burst of activity
        // doesn't thrash the reconciler.
        if (event.type === 'agent_reaction') {
          reactionsRef.current.set(event.agentId, {
            agentId: event.agentId,
            kind: event.kind,
            intensity: event.intensity,
            startedAt: performance.now(),
            duration: event.duration,
            toolName: event.toolName,
          })
          const existingTimer = reactionCleanupRef.current.get(event.agentId)
          if (existingTimer) clearTimeout(existingTimer)
          const timer = setTimeout(() => {
            reactionsRef.current.delete(event.agentId)
            reactionCleanupRef.current.delete(event.agentId)
          }, event.duration + 200)
          reactionCleanupRef.current.set(event.agentId, timer)
          return
        }

        setState(prev => applyEvent(prev, event))

        // After a graph_edge fires, de-activate the edge so the glow fades out
        if (event.type === 'graph_edge') {
          const edgeId = `${event.source}->${event.target}`
          setTimeout(() => {
            setState(prev => ({
              ...prev,
              nodes: prev.nodes.map(n => n.id === event.source && n.status === 'executing'
                ? { ...n, status: 'idle' }
                : n),
              edges: prev.edges.map(e => e.id === edgeId ? { ...e, active: false } : e),
              lastUpdated: Date.now(),
            }))
          }, EDGE_ACTIVE_TTL_MS)
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = (e) => {
      setConnected(false)
      if (e.code === 1008) {
        console.error('[AgentGraph] WebSocket closed: Unauthorized (1008) — check that cc_admin_session is set in sessionStorage')
      } else if (e.code !== 1000) {
        console.warn(`[AgentGraph] WebSocket closed: code=${e.code} reason=${e.reason || '(none)'}`)
      }
      reconnectRef.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    const cleanupMap = reactionCleanupRef.current
    return () => {
      wsRef.current?.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      for (const t of cleanupMap.values()) clearTimeout(t)
      cleanupMap.clear()
    }
  }, [connect])

  return { ...state, connected, reactionsRef }
}
