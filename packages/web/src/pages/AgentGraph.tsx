import { useState, useCallback, useMemo, useEffect } from 'react'
import { MyceliumCanvas } from '../components/MyceliumCanvas'
import { KnowledgeLibrary } from '../components/KnowledgeLibrary'
import { useAgentGraph } from '../hooks/useAgentGraph'
import { useAgentDependencies } from '../hooks/useAgentDependencies'
import { useAgentMemory } from '../hooks/useAgentMemory'
import { useNotes } from '../hooks/useNotes'
import { coreClient, type NoteWithLinks } from '../api/client'
import type { GraphEdge, GraphNode } from '../types/agent-graph'
import type { NavPage } from '../components/SideNav'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DependencyItem {
  id: string
  label: string
}

/* ------------------------------------------------------------------ */
/*  Error banner                                                       */
/* ------------------------------------------------------------------ */

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      fontSize: 11,
      color: '#ef4444',
      background: 'rgba(239,68,68,0.08)',
      border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 6,
      padding: '6px 10px',
      marginBottom: 10,
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      {message}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sidebar Panel                                                      */
/* ------------------------------------------------------------------ */

interface SidebarPanelProps {
  selectedNode: {
    id: string
    label: string
    status: string
    role: string
    toolsCount: number
    nodeType?: string
  }
  dependencies: {
    directDependencies?: DependencyItem[]
    dependents?: DependencyItem[]
    depthToLeaf?: number
  } | null
  impact: {
    totalAffected?: number
    directDependents?: DependencyItem[]
  } | null
  memory?: { contexts: number; toolsUsed: number; actions: number; bindings: number; lastActionAt: number | null } | null
  toolEdges: GraphEdge[]   // agent→tool edges for the selected agent
  onVote: (toolName: string, value: 1 | -1) => void
  isLoading: boolean
  errors: string[]
  onClose: () => void
  /** Note-mode extras — present only when selectedNode.nodeType === 'note'. */
  noteDetail?: NoteWithLinks | null
  noteBacklinks?: GraphEdge[]
  noteOutgoing?: GraphEdge[]
  onUnlinkNote?: (fromCanvasId: string, toCanvasId: string) => void
  onSelectNoteId?: (canvasId: string) => void
}

function SidebarPanel({
  selectedNode,
  dependencies,
  impact,
  memory,
  toolEdges,
  onVote,
  isLoading,
  errors,
  onClose,
  noteDetail,
  noteBacklinks = [],
  noteOutgoing = [],
  onUnlinkNote,
  onSelectNoteId,
}: SidebarPanelProps) {
  const isNote = selectedNode.nodeType === 'note'
  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, width: 320, maxHeight: 'calc(100vh - 100px)',
      background: 'rgba(13,31,51,0.95)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(0,229,255,0.20)', borderRadius: 12,
      padding: '16px', zIndex: 10,
      fontFamily: 'Space Grotesk, sans-serif',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#00e5ff', letterSpacing: '0.08em' }}>
          {(selectedNode.nodeType ?? 'agent').toUpperCase()} ANALYSIS
        </span>
        <button
          onClick={onClose}
          style={{ color: '#4a6a8a', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2f4ff', marginBottom: 4 }}>
        {selectedNode.label.toUpperCase()}
      </div>
      <div style={{ fontSize: 11, color: '#94adc4', marginBottom: 10, lineHeight: 1.5 }}>
        {selectedNode.role}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {selectedNode.nodeType === 'agent' && (
          <span style={{
            fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#94adc4',
            border: '1px solid rgba(26,58,92,0.8)', background: 'rgba(10,22,40,0.6)',
            borderRadius: 4, padding: '2px 6px',
          }}>
            {selectedNode.toolsCount} TOOLS
          </span>
        )}
        <span style={{
          fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
          color: selectedNode.status === 'offline' ? '#ef4444' : '#10b981',
          border: `1px solid ${selectedNode.status === 'offline' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
          background: selectedNode.status === 'offline' ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
          borderRadius: 4, padding: '2px 6px',
        }}>
          {selectedNode.status.toUpperCase()}
        </span>
      </div>

      {errors.length > 0 && errors.map((err) => (
        <ErrorBanner key={err} message={err} />
      ))}

      {isNote && (
        <div style={{ marginBottom: 14 }}>
          {noteDetail?.note.body && (
            <div style={{
              fontSize: 11, color: '#cfe6ff', lineHeight: 1.55,
              padding: '8px 10px', marginBottom: 10,
              background: 'rgba(167,139,250,0.06)',
              border: '1px solid rgba(167,139,250,0.18)',
              borderRadius: 6, maxHeight: 160, overflowY: 'auto',
              fontFamily: 'Space Grotesk, sans-serif',
              whiteSpace: 'pre-wrap',
            }}>
              {noteDetail.note.body}
            </div>
          )}
          {noteBacklinks.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', marginBottom: 6, letterSpacing: '0.05em' }}>
                BACKLINKS ({noteBacklinks.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {noteBacklinks.map(edge => (
                  <button
                    key={edge.id}
                    onClick={() => onSelectNoteId?.(edge.source)}
                    style={{
                      textAlign: 'left', fontSize: 10, color: '#cfe6ff',
                      padding: '4px 8px', background: 'rgba(167,139,250,0.06)',
                      border: '1px solid rgba(167,139,250,0.18)', borderRadius: 4,
                      cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    ← {edge.source.replace(/^note:/, '').slice(0, 8)}…
                    <span style={{ color: '#94adc4', marginLeft: 6 }}>{edge.label ?? 'mentions'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {noteOutgoing.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', marginBottom: 6, letterSpacing: '0.05em' }}>
                LINKS OUT ({noteOutgoing.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {noteOutgoing.map(edge => (
                  <div key={edge.id} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px', background: 'rgba(167,139,250,0.04)',
                    border: '1px solid rgba(167,139,250,0.12)', borderRadius: 4,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    <button
                      onClick={() => onSelectNoteId?.(edge.target)}
                      style={{
                        flex: 1, textAlign: 'left', background: 'none', border: 'none',
                        color: '#cfe6ff', fontSize: 10, cursor: 'pointer', padding: 0,
                      }}
                    >
                      → {edge.target.replace(/^note:/, '').slice(0, 8)}…
                      <span style={{ color: '#94adc4', marginLeft: 6 }}>{edge.label ?? 'mentions'}</span>
                    </button>
                    {onUnlinkNote && (
                      <button
                        onClick={() => onUnlinkNote(edge.source, edge.target)}
                        title="Remove this link (also signals the policy if it's an auto-mention)"
                        style={{
                          cursor: 'pointer', background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444',
                          borderRadius: 4, padding: '1px 6px', fontSize: 10, lineHeight: 1,
                        }}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {memory && selectedNode.nodeType === 'agent' && (memory.contexts + memory.toolsUsed + memory.actions + memory.bindings) > 0 && (
        <div style={{
          marginBottom: 14, padding: '8px 10px',
          background: 'rgba(0,229,255,0.05)', borderRadius: 6,
          border: '1px solid rgba(0,229,255,0.15)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#00e5ff', marginBottom: 6, letterSpacing: '0.06em' }}>
            MEMORY BLOOM
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10, color: '#94adc4', fontFamily: 'JetBrains Mono, monospace' }}>
            <div><span style={{ color: '#10b981' }}>●</span> {memory.toolsUsed} tools used</div>
            <div><span style={{ color: '#00e5ff' }}>●</span> {memory.contexts} contexts</div>
            <div><span style={{ color: '#f59e0b' }}>●</span> {memory.bindings} bindings</div>
            <div><span style={{ color: '#94adc4' }}>●</span> {memory.actions} actions</div>
          </div>
        </div>
      )}

      {selectedNode.nodeType === 'agent' && toolEdges.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginBottom: 6, letterSpacing: '0.05em' }}>
            REINFORCE TENDRILS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {toolEdges.map((edge) => {
              const toolName = edge.target.replace(/^tool:/, '')
              const w = edge.weight ?? 0.5
              return (
                <div
                  key={edge.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px',
                    background: 'rgba(245,158,11,0.04)',
                    borderRadius: 4,
                    border: '1px solid rgba(245,158,11,0.10)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, color: '#e2f4ff',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {toolName}
                    </div>
                    <div style={{
                      height: 2, background: 'rgba(0,229,255,0.15)', borderRadius: 1, marginTop: 3,
                    }}>
                      <div style={{
                        width: `${Math.round(w * 100)}%`, height: '100%',
                        background: '#10b981', borderRadius: 1,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>
                  <button
                    onClick={() => onVote(toolName, 1)}
                    title="Reinforce this connection"
                    style={{
                      cursor: 'pointer', background: 'rgba(16,185,129,0.10)',
                      border: '1px solid rgba(16,185,129,0.30)', color: '#10b981',
                      borderRadius: 4, padding: '2px 8px', fontSize: 11, lineHeight: 1,
                    }}
                  >▲</button>
                  <button
                    onClick={() => onVote(toolName, -1)}
                    title="Weaken this connection"
                    style={{
                      cursor: 'pointer', background: 'rgba(239,68,68,0.10)',
                      border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444',
                      borderRadius: 4, padding: '2px 8px', fontSize: 11, lineHeight: 1,
                    }}
                  >▼</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ fontSize: 11, color: '#94adc4', fontStyle: 'italic' }}>Loading analysis...</div>
      )}

      {dependencies && (
        <>
          {dependencies.directDependencies && dependencies.directDependencies.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#00e5ff', marginBottom: 6, letterSpacing: '0.05em' }}>
                DEPENDS ON ({dependencies.directDependencies.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {dependencies.directDependencies.map((dep) => (
                  <div key={dep.id} style={{
                    fontSize: 9, color: '#94adc4', padding: '4px 8px',
                    background: 'rgba(0,229,255,0.05)', borderRadius: 4,
                  }}>
                    {dep.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dependencies.dependents && dependencies.dependents.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#10b981', marginBottom: 6, letterSpacing: '0.05em' }}>
                DEPENDED ON BY ({dependencies.dependents.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {dependencies.dependents.map((dep) => (
                  <div key={dep.id} style={{
                    fontSize: 9, color: '#94adc4', padding: '4px 8px',
                    background: 'rgba(16,185,129,0.05)', borderRadius: 4,
                  }}>
                    {dep.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dependencies.depthToLeaf !== undefined && (
            <div style={{
              marginBottom: 14, padding: '8px',
              background: 'rgba(139,92,246,0.1)', borderRadius: 4,
              border: '1px solid rgba(139,92,246,0.2)',
            }}>
              <div style={{ fontSize: 9, color: '#8b5cf6', fontWeight: 700 }}>DEPTH TO LEAF</div>
              <div style={{ fontSize: 14, color: '#8b5cf6', fontWeight: 700 }}>{dependencies.depthToLeaf}</div>
            </div>
          )}
        </>
      )}

      {impact && (
        <>
          {impact.totalAffected !== undefined && (
            <div style={{
              marginBottom: 14, padding: '8px',
              background: 'rgba(239,68,68,0.1)', borderRadius: 4,
              border: '1px solid rgba(239,68,68,0.2)',
            }}>
              <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>IMPACT RADIUS</div>
              <div style={{ fontSize: 14, color: '#ef4444', fontWeight: 700 }}>
                {impact.totalAffected} agent{impact.totalAffected !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {impact.directDependents && impact.directDependents.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginBottom: 6, letterSpacing: '0.05em' }}>
                DIRECT IMPACT ({impact.directDependents.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {impact.directDependents.map((dep) => (
                  <div key={dep.id} style={{
                    fontSize: 9, color: '#94adc4', padding: '4px 8px',
                    background: 'rgba(245,158,11,0.05)', borderRadius: 4,
                  }}>
                    {dep.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Legend (bottom-left)                                               */
/* ------------------------------------------------------------------ */

function Legend() {
  const items = [
    { label: 'Agent',   color: '#00e5ff' },
    { label: 'Tool',    color: '#10b981' },
    { label: 'Model',   color: '#8b5cf6' },
    { label: 'Channel', color: '#f59e0b' },
    { label: 'Handoff', color: '#fb7185' },
    { label: 'Note',    color: '#a78bfa' },
  ]
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, zIndex: 10,
      background: 'rgba(13,31,51,0.85)', backdropFilter: 'blur(10px)',
      border: '1px solid rgba(0,229,255,0.15)', borderRadius: 10,
      padding: '10px 14px', display: 'flex', gap: 16,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
    }}>
      {items.map(it => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: it.color,
            boxShadow: `0 0 8px ${it.color}99`,
          }} />
          <span style={{ color: '#94adc4', letterSpacing: '0.05em' }}>{it.label.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Knowledge toggle (top-right under header)                          */
/* ------------------------------------------------------------------ */

function KnowledgeToggle({
  enabled,
  noteCount,
  onToggle,
}: { enabled: boolean; noteCount: number; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={enabled ? 'Show full agent graph' : 'Focus on knowledge notes (Obsidian mode)'}
      style={{
        position: 'absolute', top: 16, left: 16, zIndex: 10,
        background: enabled ? 'rgba(167,139,250,0.18)' : 'rgba(13,31,51,0.85)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${enabled ? 'rgba(167,139,250,0.55)' : 'rgba(167,139,250,0.20)'}`,
        borderRadius: 10, padding: '8px 14px',
        color: enabled ? '#cfe6ff' : '#a78bfa',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
        letterSpacing: '0.06em', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: '#a78bfa',
        boxShadow: enabled ? '0 0 10px #a78bfa' : 'none',
      }} />
      KNOWLEDGE
      <span style={{ color: '#94adc4', fontSize: 10 }}>({noteCount})</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function AgentGraph({ onNav: _onNav }: { onNav: (page: NavPage) => void }) {
  const { nodes: agentNodes, edges: agentEdges, connected, reactionsRef } = useAgentGraph()
  const { summary: memorySummary, refresh: refreshMemory } = useAgentMemory()
  const { noteNodes, noteEdges, refresh: refreshNotes, unlink: unlinkNote } = useNotes()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropToast, setDropToast] = useState<string | null>(null)
  // Knowledge mode brings notes forward and dims the agent/tool/model
  // machinery — Obsidian-style focus on the "thoughts" layer.
  const [knowledgeMode, setKnowledgeMode] = useState(false)

  // Merge notes into the canvas feed. In knowledge mode we dim the agent
  // half; otherwise notes show alongside everything. Selection ids in the
  // notes namespace are prefixed `note:<id>` to avoid collisions with agent ids.
  const nodes = useMemo<GraphNode[]>(() => {
    if (knowledgeMode) {
      const dimmed = agentNodes.map(n => ({ ...n, status: 'offline' as const }))
      return [...dimmed, ...noteNodes]
    }
    return [...agentNodes, ...noteNodes]
  }, [agentNodes, noteNodes, knowledgeMode])
  const edges = useMemo<GraphEdge[]>(() => [...agentEdges, ...noteEdges], [agentEdges, noteEdges])

  const {
    dependencies,
    dependenciesError,
    impact,
    impactError,
    cyclesError,
    isLoading,
  } = useAgentDependencies(selectedId && !selectedId.startsWith('note:') ? selectedId : null)

  const selectedNode = selectedId
    ? nodes.find((n) => n.id === selectedId) ?? null
    : null
  const isNoteSelected = selectedNode?.nodeType === 'note'

  // Tool tendrils rooted at the selected agent — excluding suggested (growth)
  // edges so feedback applies only to real bindings the agent actually has.
  const selectedToolEdges = selectedId && !isNoteSelected
    ? agentEdges.filter(e => e.source === selectedId && e.edgeType === 'agent-tool' && !e.suggested)
    : []

  // Backlinks for the selected note (incoming note-note edges in the merged feed).
  const selectedNoteBacklinks = useMemo(() =>
    isNoteSelected
      ? noteEdges.filter(e => e.target === selectedId)
      : [],
  [isNoteSelected, selectedId, noteEdges])
  const selectedNoteOutgoing = useMemo(() =>
    isNoteSelected
      ? noteEdges.filter(e => e.source === selectedId)
      : [],
  [isNoteSelected, selectedId, noteEdges])

  // When a note is selected, fetch its full body for the sidebar preview.
  const [selectedNoteDetail, setSelectedNoteDetail] = useState<NoteWithLinks | null>(null)
  useEffect(() => {
    if (!isNoteSelected || !selectedId) { setSelectedNoteDetail(null); return }
    const noteId = selectedId.replace(/^note:/, '')
    let cancelled = false
    coreClient.getNote(noteId)
      .then(d => { if (!cancelled) setSelectedNoteDetail(d) })
      .catch(() => { if (!cancelled) setSelectedNoteDetail(null) })
    return () => { cancelled = true }
  }, [isNoteSelected, selectedId])

  const handleUnlinkNote = useCallback(async (fromCanvasId: string, toCanvasId: string) => {
    const fromId = fromCanvasId.replace(/^note:/, '')
    const toId = toCanvasId.replace(/^note:/, '')
    await unlinkNote(fromId, toId)
  }, [unlinkNote])

  /**
   * Drop-on-agent handler — ingests each dropped file scoped to that agent,
   * so the resulting context_docs count toward the agent's per-agent memory
   * bloom (not the global shared library). Sequential to avoid slamming the
   * vision model when multiple image files drop at once.
   */
  const handleDropOnAgent = useCallback(async (agentId: string, files: FileList) => {
    const names: string[] = []
    for (const file of Array.from(files)) {
      try {
        await coreClient.ingestKnowledge(file, agentId)
        names.push(file.name)
      } catch (err) {
        console.error(`[AgentGraph] ingest failed for ${file.name}:`, err)
        setDropToast(`Failed: ${file.name}`)
        return
      }
    }
    if (names.length > 0) {
      setDropToast(`Ingested ${names.length} file${names.length > 1 ? 's' : ''} → ${agentId}`)
      refreshMemory()
      setTimeout(() => setDropToast(null), 3500)
    }
  }, [refreshMemory])

  const handleVote = useCallback(async (toolName: string, value: 1 | -1) => {
    if (!selectedId) return
    try {
      await coreClient.voteEdgeFeedback(selectedId, toolName, value)
      // The server broadcasts an edge_weight_update event over the websocket;
      // useAgentGraph's reducer patches the edge's weight in place, so the
      // tendril updates without any optimistic local state handling here.
    } catch (err) {
      console.error('[AgentGraph] feedback vote failed', err)
    }
  }, [selectedId])

  const analysisErrors: string[] = []
  if (dependenciesError) analysisErrors.push(`Dependencies: ${dependenciesError.message}`)
  if (impactError) analysisErrors.push(`Impact: ${impactError.message}`)
  if (cyclesError) analysisErrors.push(`Cycles: ${cyclesError.message}`)

  return (
    <div className="min-h-screen" style={{ background: '#050a0f' }}>

      <div style={{ position: 'fixed', top: 56, left: window.innerWidth >= 768 ? '240px' : '0', right: 0, bottom: 0 }}>
        {!connected && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.30)',
            borderRadius: 8, padding: '6px 14px',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#f59e0b',
          }}>
            reconnecting...
          </div>
        )}

        {nodes.length === 0 && connected && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 10, textAlign: 'center',
            fontFamily: 'Space Grotesk, sans-serif', color: '#4a6a8a',
          }}>
            <div style={{ fontSize: 13, letterSpacing: '0.1em', marginBottom: 6 }}>NO ACTIVITY YET</div>
            <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
              agents will appear here as they activate
            </div>
          </div>
        )}

        <MyceliumCanvas
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelectNode={setSelectedId}
          memorySummary={memorySummary}
          reactionsRef={reactionsRef}
          onDropFilesOnAgent={handleDropOnAgent}
        />

        <KnowledgeLibrary onIngestComplete={refreshMemory} />

        {dropToast && (
          <div style={{
            position: 'absolute', bottom: 72, left: '50%', transform: 'translateX(-50%)',
            zIndex: 20,
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.35)',
            borderRadius: 8, padding: '8px 16px',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#10b981',
          }}>
            {dropToast}
          </div>
        )}

        <Legend />

        <KnowledgeToggle
          enabled={knowledgeMode}
          noteCount={noteNodes.length}
          onToggle={() => {
            setKnowledgeMode(v => !v)
            void refreshNotes()
          }}
        />

        {selectedNode && (
          <SidebarPanel
            selectedNode={selectedNode}
            dependencies={dependencies}
            impact={impact}
            memory={memorySummary[selectedNode.id] ?? null}
            toolEdges={selectedToolEdges}
            onVote={handleVote}
            isLoading={isLoading}
            errors={analysisErrors}
            onClose={() => setSelectedId(null)}
            noteDetail={selectedNoteDetail}
            noteBacklinks={selectedNoteBacklinks}
            noteOutgoing={selectedNoteOutgoing}
            onUnlinkNote={handleUnlinkNote}
            onSelectNoteId={(canvasId) => setSelectedId(canvasId)}
          />
        )}
      </div>
    </div>
  )
}
