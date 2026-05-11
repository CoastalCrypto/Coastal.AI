import { useRef, useEffect, useCallback, useMemo } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceX,
  forceY,
  forceRadial,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import type { GraphNode, GraphEdge, NodeType, Reaction, ReactionKind } from '../types/agent-graph'
import type { AgentMemorySummary } from '../api/client'

interface SimNode extends SimulationNodeDatum {
  id: string
  x: number
  y: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode
  target: string | SimNode
  /** Normalized 0-1 — heavier edges pull tighter and render thicker */
  weight: number
}

interface Pulse {
  id: string
  edgeId: string
  startTs: number
  duration: number
  color: string
  /** When true, animate target → source instead of the default forward direction.
   *  Used for the return leg of a bidirectional agent↔agent handoff. */
  reverse?: boolean
}

const NODE_COLOR: Record<NodeType, { core: string; ring: string }> = {
  agent:   { core: '#00e5ff', ring: '0,229,255' },
  tool:    { core: '#10b981', ring: '16,185,129' },
  model:   { core: '#8b5cf6', ring: '139,92,246' },
  channel: { core: '#f59e0b', ring: '245,158,11' },
  // Obsidian violet — knowledge notes read as the "thoughts" layer
  // distinct from the agent/tool/model machinery.
  note:    { core: '#a78bfa', ring: '167,139,250' },
}

const NODE_RADIUS: Record<NodeType, number> = {
  agent: 22,
  tool: 14,
  model: 14,
  channel: 14,
  note: 12,
}

const EDGE_COLOR: Record<string, string> = {
  'agent-tool': '#10b981',
  'agent-model': '#8b5cf6',
  'agent-channel': '#f59e0b',
  // Warm coral — agent↔agent handoffs read as "relationship" rather than
  // the cooler tool/model/channel palette. Distinct enough at a glance.
  'agent-agent': '#fb7185',
  // Soft violet to match the note nodes — wikilinks/mentions feel like
  // ideas connecting ideas, not tools wiring to engines.
  'note-note': '#a78bfa',
}

// Deterministic hash → stable per-edge organic offset
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0
  return h
}

// Organic bezier tendril between two points
function tendrilPath(x1: number, y1: number, x2: number, y2: number, seed: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 1) return `M${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)}`

  const nx = -dy / dist
  const ny = dx / dist

  const seedA = ((seed >>> 0) % 100) / 100 - 0.5
  const seedB = ((seed >>> 8) % 100) / 100 - 0.5

  const magnitude = Math.min(dist * 0.28, 90)
  const offsetA = magnitude * seedA
  const offsetB = magnitude * seedB

  const cax = x1 + dx * 0.33 + nx * offsetA
  const cay = y1 + dy * 0.33 + ny * offsetA
  const cbx = x1 + dx * 0.66 + nx * offsetB
  const cby = y1 + dy * 0.66 + ny * offsetB

  return `M${x1.toFixed(2)},${y1.toFixed(2)} C${cax.toFixed(2)},${cay.toFixed(2)} ${cbx.toFixed(2)},${cby.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`
}

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelectNode: (id: string | null) => void
  memorySummary?: Record<string, AgentMemorySummary>
  /** Ref populated by useAgentGraph — live, per-agent "currently doing" signals.
   *  Read in the rAF loop so updates don't thrash React reconciliation. */
  reactionsRef?: React.MutableRefObject<Map<string, Reaction>>
  /** Fired when the user drops a file onto an agent node — scope the ingest
   *  to that agent so the knowledge blooms as per-agent context. */
  onDropFilesOnAgent?: (agentId: string, files: FileList) => void
}

/** Reaction color + strobe-period grammar. Unified pulse vocabulary:
 *  same ring, varied by hue and speed. Faster = more urgent activity. */
const REACTION_STYLE: Record<ReactionKind, { color: string; periodMs: number }> = {
  tool:    { color: '#10b981', periodMs: 600 },   // green, fast
  memory:  { color: '#00e5ff', periodMs: 900 },   // cyan, medium
  skill:   { color: '#f59e0b', periodMs: 750 },   // amber, medium-fast
  handoff: { color: '#f97316', periodMs: 1100 },  // orange, slow (deliberate)
  search:  { color: '#8b5cf6', periodMs: 700 },   // violet, medium-fast
  think:   { color: '#a8e6ff', periodMs: 1400 },  // pale cyan, slow breath
}

interface Satellite {
  /** Unique key per (agentId, kind, slot) so additions can bloom-in */
  key: string
  kind: 'context' | 'tool' | 'binding'
  /** Angle in radians on the orbit */
  angle: number
  /** Orbit radius from the agent center */
  radius: number
  /** Drift speed (radians per ms) — small positive or negative for variety */
  drift: number
  /** Particle radius */
  size: number
}

const SATELLITE_COLOR: Record<Satellite['kind'], string> = {
  context: '#00e5ff',
  tool: '#10b981',
  binding: '#f59e0b',
}

const MAX_SATELLITES_PER_KIND = 6

/**
 * Build a deterministic satellite layout from a memory summary.
 * Same counts always produce the same arrangement, so satellites
 * stay in their orbital slots across renders — only newly-added
 * satellites bloom in.
 */
function buildSatellites(
  agentId: string,
  summary: AgentMemorySummary | undefined,
  agentRadius: number,
): Satellite[] {
  if (!summary) return []
  const sats: Satellite[] = []
  const seed = hashString(agentId)

  const groups: Array<{ kind: Satellite['kind']; count: number; orbit: number; sizeRange: [number, number] }> = [
    { kind: 'tool',    count: Math.min(summary.toolsUsed,  MAX_SATELLITES_PER_KIND), orbit: agentRadius + 18, sizeRange: [2.4, 3.6] },
    { kind: 'context', count: Math.min(summary.contexts,   MAX_SATELLITES_PER_KIND), orbit: agentRadius + 30, sizeRange: [2.0, 3.0] },
    { kind: 'binding', count: Math.min(summary.bindings,   MAX_SATELLITES_PER_KIND), orbit: agentRadius + 42, sizeRange: [1.8, 2.6] },
  ]

  for (const g of groups) {
    if (g.count === 0) continue
    const angleStep = (Math.PI * 2) / Math.max(g.count, 4)
    const baseAngle = ((seed >>> (g.kind === 'tool' ? 0 : g.kind === 'context' ? 8 : 16)) % 360) * (Math.PI / 180)
    const driftSign = ((seed >>> 4) & 1) === 0 ? 1 : -1
    const driftBase = g.kind === 'tool' ? 0.00012 : g.kind === 'context' ? 0.00008 : 0.00005
    for (let i = 0; i < g.count; i++) {
      const slotSeed = hashString(`${agentId}|${g.kind}|${i}`)
      const sizeJitter = ((slotSeed >>> 0) % 100) / 100
      const size = g.sizeRange[0] + (g.sizeRange[1] - g.sizeRange[0]) * sizeJitter
      sats.push({
        key: `${agentId}|${g.kind}|${i}`,
        kind: g.kind,
        angle: baseAngle + i * angleStep,
        radius: g.orbit + ((slotSeed >>> 8) % 6) - 3,
        drift: driftSign * driftBase * (0.7 + sizeJitter * 0.6),
        size,
      })
    }
  }

  return sats
}

export function MyceliumCanvas({ nodes, edges, selectedId, onSelectNode, memorySummary, reactionsRef, onDropFilesOnAgent }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const nodeGroupRef = useRef<SVGGElement>(null)
  const edgeGroupRef = useRef<SVGGElement>(null)
  const pulseGroupRef = useRef<SVGGElement>(null)
  const reactionGroupRef = useRef<SVGGElement>(null)

  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const animationRef = useRef<number | null>(null)
  const pulsesRef = useRef<Pulse[]>([])
  const prevEdgeActiveRef = useRef<Map<string, boolean>>(new Map())
  const edgesRef = useRef<GraphEdge[]>([])
  const nodesRef = useRef<GraphNode[]>([])

  // Keep latest arrays accessible to the rAF loop without restarting the simulation
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  // Detect edge active transitions → spawn pulse particles
  useEffect(() => {
    const now = performance.now()
    for (const edge of edges) {
      const wasActive = prevEdgeActiveRef.current.get(edge.id) ?? false
      if (edge.active && !wasActive) {
        const color = EDGE_COLOR[edge.edgeType ?? ''] ?? '#00e5ff'
        const rand = Math.random().toString(36).slice(2, 6)
        pulsesRef.current.push({
          id: `${edge.id}-${now.toFixed(0)}-${rand}`,
          edgeId: edge.id,
          startTs: now,
          duration: 900,
          color,
        })
        // Agent↔agent handoffs are conversations, not one-way sends.
        // Fire a delayed return pulse so the user sees the reply travel
        // back to the initiating agent — a visible dialogue beat.
        if (edge.edgeType === 'agent-agent') {
          pulsesRef.current.push({
            id: `${edge.id}-${now.toFixed(0)}-${rand}-r`,
            edgeId: edge.id,
            startTs: now + 550,
            duration: 900,
            color,
            reverse: true,
          })
        }
      }
      prevEdgeActiveRef.current.set(edge.id, edge.active)
    }
    // Clean up stale entries
    const currentIds = new Set(edges.map(e => e.id))
    for (const id of prevEdgeActiveRef.current.keys()) {
      if (!currentIds.has(id)) prevEdgeActiveRef.current.delete(id)
    }
  }, [edges])

  // Fingerprint only includes structural changes (ids), not status/active flags.
  // The rAF loop reads live arrays from refs for colors/thickness/pulses.
  const dataFingerprint = useMemo(
    () => `${nodes.map(n => n.id).sort().join(',')}|${edges.map(e => e.id).sort().join(',')}`,
    [nodes, edges],
  )

  // Simulation setup + imperative rAF render loop
  useEffect(() => {
    if (nodes.length === 0) return
    const svg = svgRef.current
    if (!svg) return

    const width = svg.clientWidth || 1200
    const height = svg.clientHeight || 800
    const cx = width / 2
    const cy = height / 2

    const simNodes: SimNode[] = nodes.map(n => {
      const saved = positionsRef.current.get(n.id)
      return {
        id: n.id,
        x: saved?.x ?? cx + (Math.random() - 0.5) * 200,
        y: saved?.y ?? cy + (Math.random() - 0.5) * 200,
      }
    })

    const simLinks: SimLink[] = edges.map(e => ({
      source: e.source,
      target: e.target,
      // Suggested edges shouldn't tug the layout — they're hypotheses, not bindings.
      // A faint pull keeps suggested tools loosely orbiting their proposing agent
      // so the user sees the relationship without the graph distorting around it.
      weight: e.suggested ? 0.05 : (e.weight ?? 0.5),
    }))

    if (simulationRef.current) simulationRef.current.stop()
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)

    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        // Heavier-used edges pull tighter; light edges stretch out organically
        .distance(d => 180 - d.weight * 60)
        .strength(d => 0.3 + d.weight * 0.5))
      .force('charge', forceManyBody().strength(-750))
      .force('center', forceCenter(cx, cy))
      .force('radial', forceRadial(220, cx, cy).strength(0.07))
      .force('x', forceX(cx).strength(0.015))
      .force('y', forceY(cy).strength(0.015))
      .alphaDecay(0.025)
      .stop()

    simulationRef.current = sim

    const render = () => {
      if (sim.alpha() > sim.alphaMin()) sim.tick()

      // Persist positions
      const simNodesList = sim.nodes()
      for (const sn of simNodesList) {
        positionsRef.current.set(sn.id, { x: sn.x, y: sn.y })
      }

      // Update node group transforms
      const nodeGroup = nodeGroupRef.current
      if (nodeGroup) {
        for (const sn of simNodesList) {
          const g = nodeGroup.querySelector<SVGGElement>(`[data-nid="${CSS.escape(sn.id)}"]`)
          if (g) g.setAttribute('transform', `translate(${sn.x.toFixed(2)},${sn.y.toFixed(2)})`)
        }
      }

      // Update edge paths
      const edgeGroup = edgeGroupRef.current
      if (edgeGroup) {
        for (const edge of edgesRef.current) {
          const sPos = positionsRef.current.get(edge.source)
          const tPos = positionsRef.current.get(edge.target)
          if (!sPos || !tPos) continue
          const path = edgeGroup.querySelector<SVGPathElement>(`[data-eid="${CSS.escape(edge.id)}"]`)
          if (path) {
            const seed = hashString(edge.id)
            path.setAttribute('d', tendrilPath(sPos.x, sPos.y, tPos.x, tPos.y, seed))
          }
        }
      }

      // Update pulses
      const pulseGroup = pulseGroupRef.current
      if (pulseGroup) {
        const now = performance.now()
        const active = pulsesRef.current.filter(p => now >= p.startTs && now - p.startTs < p.duration)
        // Keep future-scheduled (return-leg) pulses alive until they fire
        pulsesRef.current = pulsesRef.current.filter(p => now - p.startTs < p.duration)

        const live = new Set(active.map(p => p.id))
        for (const child of Array.from(pulseGroup.children)) {
          const pid = (child as SVGElement).getAttribute('data-pid')
          if (!pid || !live.has(pid)) pulseGroup.removeChild(child)
        }

        for (const p of active) {
          const edge = edgesRef.current.find(e => e.id === p.edgeId)
          if (!edge) continue
          const pathEl = edgeGroup?.querySelector<SVGPathElement>(`[data-eid="${CSS.escape(edge.id)}"]`)
          if (!pathEl) continue

          const t = (now - p.startTs) / p.duration
          const ease = 1 - Math.pow(1 - t, 3)
          // Reverse traversal for the return leg of bidirectional handoffs
          const sampled = p.reverse ? 1 - ease : ease

          let pt: { x: number; y: number }
          try {
            const length = pathEl.getTotalLength()
            const point = pathEl.getPointAtLength(length * sampled)
            pt = { x: point.x, y: point.y }
          } catch {
            const sPos = positionsRef.current.get(edge.source)
            const tPos = positionsRef.current.get(edge.target)
            if (!sPos || !tPos) continue
            pt = { x: sPos.x + (tPos.x - sPos.x) * sampled, y: sPos.y + (tPos.y - sPos.y) * sampled }
          }

          // Two-layer particle: soft halo + bright core for an energy-burst feel
          let halo = pulseGroup.querySelector<SVGCircleElement>(`[data-pid="${CSS.escape(p.id)}"][data-ph="halo"]`)
          if (!halo) {
            halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
            halo.setAttribute('data-pid', p.id)
            halo.setAttribute('data-ph', 'halo')
            halo.setAttribute('r', '9')
            halo.setAttribute('fill', p.color)
            halo.setAttribute('opacity', '0')
            halo.setAttribute('filter', 'url(#pulse-glow)')
            pulseGroup.appendChild(halo)
          }
          let core = pulseGroup.querySelector<SVGCircleElement>(`[data-pid="${CSS.escape(p.id)}"][data-ph="core"]`)
          if (!core) {
            core = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
            core.setAttribute('data-pid', p.id)
            core.setAttribute('data-ph', 'core')
            core.setAttribute('r', '3')
            core.setAttribute('fill', '#ffffff')
            core.setAttribute('filter', 'url(#pulse-glow)')
            pulseGroup.appendChild(core)
          }
          halo.setAttribute('cx', pt.x.toFixed(2))
          halo.setAttribute('cy', pt.y.toFixed(2))
          core.setAttribute('cx', pt.x.toFixed(2))
          core.setAttribute('cy', pt.y.toFixed(2))
          const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1
          halo.setAttribute('opacity', (fade * 0.6).toFixed(2))
          core.setAttribute('opacity', fade.toFixed(2))
        }
      }

      // Reaction halos — read live from ref, render one animated ring per
      // active reaction. Imperative DOM updates avoid re-render thrash when
      // dozens of reactions fire per second across many agents.
      const reactionGroup = reactionGroupRef.current
      const reactions = reactionsRef?.current
      if (reactionGroup && reactions) {
        const now = performance.now()
        const live = new Set<string>()
        for (const [agentId, r] of reactions) {
          const age = now - r.startedAt
          if (age > r.duration) continue
          live.add(agentId)
          const pos = positionsRef.current.get(agentId)
          if (!pos) continue

          const style = REACTION_STYLE[r.kind] ?? REACTION_STYLE.tool
          // Sinusoidal strobe — breath in, breath out, then fade at tail
          const phase = (now % style.periodMs) / style.periodMs
          const breath = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2)
          const lifeFade = age < 200 ? age / 200 : age > r.duration - 300 ? (r.duration - age) / 300 : 1
          const scale = 1.6 + breath * 0.9 * r.intensity
          const opacity = (0.35 + breath * 0.55) * lifeFade

          const key = `reaction:${agentId}`
          let ring = reactionGroup.querySelector<SVGCircleElement>(`[data-rid="${CSS.escape(key)}"]`)
          if (!ring) {
            ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
            ring.setAttribute('data-rid', key)
            ring.setAttribute('fill', 'none')
            ring.setAttribute('stroke-width', '2')
            ring.setAttribute('filter', 'url(#pulse-glow)')
            ring.setAttribute('pointerEvents', 'none')
            reactionGroup.appendChild(ring)
          }
          ring.setAttribute('cx', pos.x.toFixed(2))
          ring.setAttribute('cy', pos.y.toFixed(2))
          ring.setAttribute('r', (28 * scale).toFixed(2))
          ring.setAttribute('stroke', style.color)
          ring.setAttribute('opacity', opacity.toFixed(2))
        }
        // Remove dead rings
        for (const child of Array.from(reactionGroup.children)) {
          const rid = (child as SVGElement).getAttribute('data-rid')
          const agentId = rid?.replace(/^reaction:/, '') ?? ''
          if (!live.has(agentId)) reactionGroup.removeChild(child)
        }
      }

      animationRef.current = requestAnimationFrame(render)
    }

    sim.alpha(1).restart().stop()
    animationRef.current = requestAnimationFrame(render)

    return () => {
      sim.stop()
      simulationRef.current = null
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFingerprint])

  const handleBackgroundClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target === e.currentTarget || (e.target as Element).tagName === 'rect') {
      onSelectNode(null)
    }
  }, [onSelectNode])

  // Build a set of connected node ids for dimming effect
  const connectedIds = useMemo(() => {
    if (!selectedId) return null
    const set = new Set<string>([selectedId])
    for (const e of edges) {
      if (e.source === selectedId) set.add(e.target)
      if (e.target === selectedId) set.add(e.source)
    }
    return set
  }, [selectedId, edges])

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      style={{ display: 'block', background: 'radial-gradient(ellipse at center, #0a1628 0%, #050a0f 80%)' }}
      onClick={handleBackgroundClick}
    >
      <defs>
        <filter id="pulse-glow" x="-250%" y="-250%" width="600%" height="600%">
          <feGaussianBlur stdDeviation="2" result="core-blur" />
          <feGaussianBlur stdDeviation="6" result="halo-blur" in="SourceGraphic" />
          <feMerge>
            <feMergeNode in="halo-blur" />
            <feMergeNode in="halo-blur" />
            <feMergeNode in="core-blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="depth-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r="0.8" fill="rgba(0,229,255,0.055)" />
        </pattern>
        {(Object.keys(NODE_COLOR) as NodeType[]).map(type => (
          <radialGradient key={type} id={`halo-${type}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={NODE_COLOR[type].core} stopOpacity="0.7" />
            <stop offset="55%" stopColor={NODE_COLOR[type].core} stopOpacity="0.25" />
            <stop offset="100%" stopColor={NODE_COLOR[type].core} stopOpacity="0" />
          </radialGradient>
        ))}
        <style>{`
          @keyframes mycelium-breath {
            0%, 100% { opacity: 0.75; }
            50% { opacity: 1; }
          }
          @keyframes mycelium-pulse {
            0%, 100% { transform: scale(1); opacity: 0.35; }
            50% { transform: scale(1.25); opacity: 0.7; }
          }
          .tendril-idle {
            stroke-dasharray: 2 10;
            opacity: 0.35;
          }
          .tendril-active {
            stroke-dasharray: 6 8;
            animation: tendril-flow 0.9s linear infinite;
          }
          @keyframes tendril-flow {
            to { stroke-dashoffset: -24; }
          }
          @keyframes suggested-shimmer {
            0%, 100% { stroke-opacity: 0.18; }
            50%      { stroke-opacity: 0.42; }
          }
          .tendril-suggested {
            stroke-dasharray: 3 7;
            animation: suggested-shimmer 3.4s ease-in-out infinite;
          }
          @keyframes satellite-bloom {
            from { opacity: 0; transform: scale(0.1); }
            to   { opacity: 0.85; transform: scale(1); }
          }
          .satellite-bloom {
            transform-origin: center;
            transform-box: fill-box;
            animation: satellite-bloom 800ms ease-out both;
          }
          .mycelium-halo-active {
            animation: mycelium-pulse 1.8s ease-in-out infinite;
            transform-origin: center;
            transform-box: fill-box;
          }
          .mycelium-core-breath {
            animation: mycelium-breath 3s ease-in-out infinite;
            transform-origin: center;
            transform-box: fill-box;
          }
        `}</style>
      </defs>

      {/* Depth grid — fine dots give the canvas a sense of scale */}
      <rect x="0" y="0" width="100%" height="100%" fill="url(#depth-grid)" pointerEvents="none" />

      {/* Edges */}
      <g ref={edgeGroupRef}>
        {edges.map(e => {
          const color = EDGE_COLOR[e.edgeType ?? ''] ?? '#4a6a8a'
          const relevant = !selectedId || (connectedIds && connectedIds.has(e.source) && connectedIds.has(e.target))
          const dim = selectedId && !relevant
          const w = e.weight ?? 0.5

          if (e.suggested) {
            // Ghost tendril — proposes a connection without claiming it exists.
            // Color stays in the agent-tool family but desaturates toward white
            // to read as "potential" rather than "active".
            const sScore = e.suggestionScore ?? 0
            return (
              <path
                key={e.id}
                data-eid={e.id}
                d="M0,0"
                fill="none"
                stroke="#a8e6ff"
                strokeWidth={0.5 + sScore * 1.0}
                strokeOpacity={dim ? 0.04 : 0.25}
                strokeLinecap="round"
                className="tendril-suggested"
                pointerEvents="none"
              />
            )
          }

          // Heavily-used edges render thicker and brighter — interaction history made visible
          const baseWidth = 0.6 + w * 2.0
          const baseOpacity = 0.15 + w * 0.55
          return (
            <path
              key={e.id}
              data-eid={e.id}
              d="M0,0"
              fill="none"
              stroke={color}
              strokeWidth={e.active ? baseWidth + 1.0 : baseWidth}
              strokeOpacity={dim ? 0.06 : e.active ? Math.min(baseOpacity + 0.25, 0.95) : 0.35}
              strokeLinecap="round"
              className={e.active ? 'tendril-active' : 'tendril-idle'}
              style={{ transition: 'stroke-width 0.4s ease, stroke-opacity 0.4s ease' }}
            />
          )
        })}
      </g>

      {/* Reaction halos — live per-agent "currently doing" indicators */}
      <g ref={reactionGroupRef} pointerEvents="none" />

      {/* Pulses */}
      <g ref={pulseGroupRef} pointerEvents="none" />

      {/* Nodes */}
      <g ref={nodeGroupRef}>
        {nodes.map(n => {
          const type = (n.nodeType ?? 'agent') as NodeType
          const color = NODE_COLOR[type]
          const radius = NODE_RADIUS[type]
          const isSelected = n.id === selectedId
          const isActive = n.status === 'thinking' || n.status === 'executing'
          const isOffline = n.status === 'offline'
          const isError = n.status === 'error'
          const dim = selectedId !== null && !connectedIds?.has(n.id)

          const labelColor = isOffline ? '#4a6a8a' : isSelected ? '#ffffff' : '#e2f4ff'
          const ring = isError ? '#ef4444' : isSelected ? '#ffffff' : `rgba(${color.ring},0.65)`
          const coreFill = isOffline ? '#1a3a5c' : color.core

          const isDropTarget = type === 'agent' && !isOffline && !!onDropFilesOnAgent
          return (
            <g
              key={n.id}
              data-nid={n.id}
              transform="translate(0,0)"
              style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1, transition: 'opacity 0.3s ease' }}
              onClick={(ev) => { ev.stopPropagation(); onSelectNode(n.id === selectedId ? null : n.id) }}
              onDragOver={isDropTarget ? (ev) => {
                // Allow drop only if data transfer contains files
                if (Array.from(ev.dataTransfer.items).some(it => it.kind === 'file')) {
                  ev.preventDefault()
                  ev.stopPropagation()
                  ev.dataTransfer.dropEffect = 'copy'
                  ;(ev.currentTarget as SVGGElement).setAttribute('data-drop-hover', '1')
                }
              } : undefined}
              onDragLeave={isDropTarget ? (ev) => {
                ;(ev.currentTarget as SVGGElement).removeAttribute('data-drop-hover')
              } : undefined}
              onDrop={isDropTarget ? (ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                ;(ev.currentTarget as SVGGElement).removeAttribute('data-drop-hover')
                if (ev.dataTransfer.files.length > 0) {
                  onDropFilesOnAgent!(n.id, ev.dataTransfer.files)
                }
              } : undefined}
            >
              {/* Outer ring — thin stroke defines the edge of the object */}
              <circle
                r={radius + 3.5}
                fill="none"
                stroke={ring}
                strokeWidth={0.75}
                opacity={isOffline ? 0.08 : 0.30}
                pointerEvents="none"
              />
              {/* Halo */}
              <circle
                r={radius * 2.3}
                fill={`url(#halo-${type})`}
                className={isActive ? 'mycelium-halo-active' : undefined}
                opacity={isActive ? 0.6 : isOffline ? 0.1 : 0.3}
                pointerEvents="none"
              />
              {/* Core */}
              <circle
                r={radius}
                fill={coreFill}
                stroke={ring}
                strokeWidth={isSelected ? 2.5 : 1.5}
                opacity={isOffline ? 0.5 : 1}
                filter="url(#node-glow)"
                className={!isActive && !isOffline ? 'mycelium-core-breath' : undefined}
              />
              {/* Inner specular — top-left highlight simulates dome lighting */}
              {type === 'agent' && !isOffline && (
                <circle
                  cx={-radius * 0.28}
                  cy={-radius * 0.28}
                  r={radius * 0.18}
                  fill="#ffffff"
                  opacity={isActive ? 0.5 : 0.22}
                  pointerEvents="none"
                />
              )}
              {/* Memory bloom satellites — orbit the agent, encode learning */}
              {type === 'agent' && !isOffline && buildSatellites(n.id, memorySummary?.[n.id], radius).map(sat => {
                const orbitDurationSec = (2 * Math.PI / Math.abs(sat.drift) / 1000)
                const initialAngleDeg = (sat.angle * 180) / Math.PI
                const endAngleDeg = sat.drift > 0 ? initialAngleDeg + 360 : initialAngleDeg - 360
                return (
                  <g key={sat.key} pointerEvents="none">
                    <circle
                      cx={sat.radius}
                      cy={0}
                      r={sat.size}
                      fill={SATELLITE_COLOR[sat.kind]}
                      opacity={0.85}
                      filter="url(#node-glow)"
                      className="satellite-bloom"
                    />
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`${initialAngleDeg.toFixed(2)} 0 0`}
                      to={`${endAngleDeg.toFixed(2)} 0 0`}
                      dur={`${orbitDurationSec.toFixed(1)}s`}
                      repeatCount="indefinite"
                    />
                  </g>
                )
              })}
              {/* Label */}
              <text
                y={radius + 16}
                textAnchor="middle"
                fill={labelColor}
                fontSize={type === 'agent' ? 11 : 9}
                fontWeight={700}
                fontFamily="Space Grotesk, sans-serif"
                style={{ letterSpacing: '0.06em', pointerEvents: 'none', userSelect: 'none' }}
              >
                {n.label.toUpperCase().slice(0, 16)}
              </text>
              {/* Tools count for agents */}
              {type === 'agent' && !isOffline && (
                <text
                  y={radius + 29}
                  textAnchor="middle"
                  fill="#94adc4"
                  fontSize={9}
                  fontFamily="JetBrains Mono, monospace"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {n.toolsCount} tools
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
