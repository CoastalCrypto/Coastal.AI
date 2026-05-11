export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'error' | 'offline'
export type NodeType = 'agent' | 'tool' | 'model' | 'channel' | 'note'

export interface GraphNode {
  id: string
  label: string
  status: AgentStatus
  role: string
  toolsCount: number
  nodeType?: NodeType
  lastActivity?: number
  position?: { x: number; y: number }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label?: string
  active: boolean
  edgeType?: 'agent-tool' | 'agent-model' | 'agent-channel' | 'agent-agent' | 'note-note'
  /** Normalized 0-1 strength derived from interaction history. 1 = heavily used */
  weight?: number
  /** Timestamp of the most recent interaction across this edge */
  lastUsedAt?: number | null
  /** True if this edge is a growth suggestion (data-mined, not a real binding) */
  suggested?: boolean
  /** Normalized 0-1 confidence of the suggestion */
  suggestionScore?: number
  /** For suggested edges: an existing tool the agent has that pairs strongly with this one */
  suggestionPairedWith?: string
}

export interface AgentGraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  lastUpdated: number
}

// Agent graph WebSocket events
export type AgentGraphEvent =
  | { type: 'snapshot'; nodes: GraphNode[]; edges: GraphEdge[] }
  | { type: 'node_status'; nodeId: string; status: AgentStatus }
  | { type: 'node_added'; node: GraphNode }
  | { type: 'node_removed'; nodeId: string }
  | { type: 'edge_added'; edge: GraphEdge }
  | { type: 'edge_removed'; edgeId: string }
  | { type: 'edge_active'; edgeId: string; active: boolean }
  | { type: 'graph_edge'; ts: number; source: string; target: string; edgeType: 'agent-tool' | 'agent-model' | 'agent-channel' | 'agent-agent' }
  | { type: 'edge_weight_update'; ts: number; edgeId: string; weight: number; feedbackScore: number }
  | { type: 'agent_reaction'; ts: number; agentId: string; kind: ReactionKind; intensity: number; duration: number; toolName?: string }
  | { type: 'ping' }

/** What flavor of work an agent is doing — drives color + strobe speed on the canvas */
export type ReactionKind = 'tool' | 'memory' | 'skill' | 'handoff' | 'search' | 'think'

export interface Reaction {
  agentId: string
  kind: ReactionKind
  intensity: number    // 0-1
  startedAt: number    // performance.now()
  duration: number     // ms
  toolName?: string
}

// React Flow node data type — index signature required for React Flow compatibility
export interface AgentNodeData extends Record<string, unknown> {
  label: string
  status: AgentStatus
  role: string
  toolsCount: number
  nodeType?: NodeType
  lastActivity?: number
}
