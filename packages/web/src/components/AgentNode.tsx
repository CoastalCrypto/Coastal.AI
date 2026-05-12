import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { AgentNodeData, AgentStatus, NodeType } from '../types/agent-graph'

const STATUS_RING: Record<AgentStatus, string> = {
  idle:      '2px solid rgba(0,229,255,0.25)',
  thinking:  '2px solid #00e5ff',
  executing: '2px solid #10b981',
  error:     '2px solid #ef4444',
  offline:   '2px solid #1a3a5c',
}

const STATUS_GLOW: Record<AgentStatus, string | undefined> = {
  idle:      undefined,
  thinking:  '0 0 12px rgba(0,229,255,0.40)',
  executing: '0 0 12px rgba(16,185,129,0.40)',
  error:     '0 0 12px rgba(239,68,68,0.40)',
  offline:   undefined,
}

const STATUS_DOT: Record<AgentStatus, string> = {
  idle:      '#94adc4',
  thinking:  '#00e5ff',
  executing: '#10b981',
  error:     '#ef4444',
  offline:   '#4a6a8a',
}

const NODE_ICON: Record<NodeType, string> = {
  agent:   '✳',
  tool:    '⚙',
  model:   '◈',
  channel: '⬡',
  note:    '◎',
}

const NODE_COLOR: Record<NodeType, { bg: string; border: string; label: string }> = {
  agent:   { bg: 'rgba(13,31,51,0.95)',   border: 'rgba(0,229,255,0.25)',  label: '#e2f4ff' },
  tool:    { bg: 'rgba(10,28,20,0.95)',   border: 'rgba(16,185,129,0.30)', label: '#6ee7b7' },
  model:   { bg: 'rgba(20,15,35,0.95)',   border: 'rgba(139,92,246,0.30)', label: '#c4b5fd' },
  channel: { bg: 'rgba(28,20,8,0.95)',    border: 'rgba(245,158,11,0.30)', label: '#fcd34d' },
  note:    { bg: 'rgba(22,15,40,0.95)',   border: 'rgba(167,139,250,0.30)', label: '#cfe6ff' },
}

interface Props {
  data: AgentNodeData
  selected: boolean
}

export const AgentNode = memo(function AgentNode({ data, selected }: Props) {
  const status = data.status as AgentStatus
  const nodeType = (data.nodeType as NodeType | undefined) ?? 'agent'
  const isPulsing = status === 'thinking' || status === 'executing'
  const colors = NODE_COLOR[nodeType]
  const icon = NODE_ICON[nodeType]

  // Non-agent nodes: compact square pill
  if (nodeType !== 'agent') {
    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <Handle type="target" position={Position.Top} style={{ background: '#1a3a5c', border: `1px solid ${colors.border}`, width: 6, height: 6 }} />
        <div style={{
          minWidth: 80,
          padding: '6px 10px',
          borderRadius: 8,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          boxShadow: selected ? `0 0 0 2px ${colors.border}` : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          transition: 'all 0.2s',
          opacity: status === 'offline' ? 0.5 : 1,
        }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>
          <div>
            <div style={{
              fontSize: 9,
              fontWeight: 700,
              color: colors.label,
              fontFamily: 'Space Grotesk, sans-serif',
              letterSpacing: '0.04em',
              maxWidth: 100,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {(data.label as string).toUpperCase()}
            </div>
            <div style={{ fontSize: 8, color: '#4a6a8a', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
              {data.role as string}
            </div>
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} style={{ background: '#1a3a5c', border: `1px solid ${colors.border}`, width: 6, height: 6 }} />
      </div>
    )
  }

  // Agent node: original circle design
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <Handle type="target" position={Position.Top} style={{ background: '#1a3a5c', border: '1px solid rgba(0,229,255,0.3)', width: 8, height: 8 }} />

      <div style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: selected ? 'rgba(0,229,255,0.12)' : 'rgba(13,31,51,0.95)',
        border: STATUS_RING[status],
        boxShadow: [
          STATUS_GLOW[status],
          selected ? '0 0 0 2px rgba(0,229,255,0.4)' : undefined,
        ].filter(Boolean).join(', ') || undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        animation: isPulsing ? 'agent-ping 2s ease-in-out infinite alternate' : undefined,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1, filter: status === 'offline' ? 'grayscale(1) opacity(0.4)' : undefined }}>✳</span>
      </div>

      <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: status === 'offline' ? '#4a6a8a' : '#e2f4ff',
          fontFamily: 'Space Grotesk, sans-serif',
          letterSpacing: '0.06em',
          maxWidth: 80,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {(data.label as string).toUpperCase()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_DOT[status] }} />
          <span style={{ fontSize: 9, color: '#94adc4', fontFamily: 'JetBrains Mono, monospace' }}>
            {data.toolsCount as number} tools
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: '#1a3a5c', border: '1px solid rgba(0,229,255,0.3)', width: 8, height: 8 }} />
    </div>
  )
})
