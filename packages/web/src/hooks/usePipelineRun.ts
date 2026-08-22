import { useEffect, useRef, useState } from 'react'
import { coreHttpOrigin } from '../platform/coreOrigin'

function adminHeaders(): Record<string, string> {
  const session = sessionStorage.getItem('cc_admin_session') ?? ''
  return session ? { 'x-admin-session': session } : {}
}

// EventSource can't send the x-admin-session header, so a network-exposed
// server requires a short-lived ticket (minted via an ordinary,
// header-authenticated POST) passed as a query param instead. Shared with
// /api/events — a ticket just proves "recently authenticated," it isn't
// tied to a specific stream.
async function fetchTicket(): Promise<string | null> {
  try {
    const res = await fetch('/api/events/ticket', { method: 'POST', headers: adminHeaders() })
    if (!res.ok) return null
    const { ticket } = await res.json() as { ticket: string }
    return ticket
  } catch {
    return null
  }
}

export interface LiveToolCall {
  toolName: string
  args: Record<string, unknown>
  result?: string
  durationMs?: number
  status: 'running' | 'done'
}

export interface LiveStage {
  stageIdx: number
  agentId: string
  agentName: string
  status: 'waiting' | 'running' | 'done' | 'error'
  toolCalls: LiveToolCall[]
  steerMessages: string[]
  output?: string
  durationMs?: number
  iteration: number
}

export interface PipelineRunState {
  runId: string
  status: 'running' | 'done' | 'error' | 'aborted'
  stageCount: number
  activeStageIdx: number
  stages: LiveStage[]
  finalOutput?: string
  error?: string
}

export function usePipelineRun(runId: string | null, stageCount: number) {
  const [state, setState] = useState<PipelineRunState | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!runId) return
    setState({
      runId,
      status: 'running',
      stageCount,
      activeStageIdx: 0,
      stages: Array.from({ length: stageCount }, (_, i) => ({
        stageIdx: i, agentId: '', agentName: `Stage ${i + 1}`,
        status: 'waiting', toolCalls: [], steerMessages: [], iteration: 0,
      })),
    })

    let cancelled = false
    void (async () => {
      const ticket = await fetchTicket()
      if (cancelled) return

      const url = ticket
        ? `${coreHttpOrigin()}/api/pipeline/run/${runId}/events?ticket=${encodeURIComponent(ticket)}`
        : `${coreHttpOrigin()}/api/pipeline/run/${runId}/events`
      const es = new EventSource(url)
      esRef.current = es

      es.onmessage = (e) => {
        const event = JSON.parse(e.data)
        setState(prev => {
          if (!prev) return prev
          return applyEvent(prev, event)
        })
      }
      es.onerror = () => {
        // Don't overwrite 'done' — stream closes normally after pipeline completes
        setState(prev => prev && prev.status !== 'done' ? { ...prev, status: 'error' } : prev)
        es.close()
      }
    })()

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [runId])

  const steer = async (message: string) => {
    if (!runId) return
    await fetch(`/api/pipeline/run/${runId}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ message }),
    })
  }

  const abort = async () => {
    if (!runId) return
    await fetch(`/api/pipeline/run/${runId}`, { method: 'DELETE', headers: adminHeaders() })
  }

  return { state, steer, abort }
}

function applyEvent(state: PipelineRunState, event: any): PipelineRunState {
  const stages = [...state.stages]
  switch (event.type) {
    case 'stage_start': {
      const s = { ...stages[event.stageIdx] }
      s.status = 'running'
      s.agentId = event.agentId
      s.agentName = event.agentName
      s.iteration = event.iteration
      s.toolCalls = []
      stages[event.stageIdx] = s
      return { ...state, activeStageIdx: event.stageIdx, stages }
    }
    case 'tool_call_start': {
      const idx = stageIdxFromSession(state.runId, event.sessionId)
      if (idx < 0 || idx >= stages.length) return state
      const s = { ...stages[idx], toolCalls: [...stages[idx].toolCalls] }
      s.toolCalls.push({ toolName: event.toolName, args: event.args, status: 'running' })
      stages[idx] = s
      return { ...state, stages }
    }
    case 'tool_call_end': {
      const idx = stageIdxFromSession(state.runId, event.sessionId)
      if (idx < 0 || idx >= stages.length) return state
      const s = { ...stages[idx], toolCalls: [...stages[idx].toolCalls] }
      const tcIdx = s.toolCalls.findLastIndex(t => t.toolName === event.toolName && t.status === 'running')
      if (tcIdx >= 0) {
        s.toolCalls[tcIdx] = { ...s.toolCalls[tcIdx], status: 'done', durationMs: event.durationMs }
      }
      stages[idx] = s
      return { ...state, stages }
    }
    case 'stage_steer': {
      const idx = state.activeStageIdx
      if (idx < 0 || idx >= stages.length) return state
      const s = { ...stages[idx], steerMessages: [...stages[idx].steerMessages, event.message] }
      stages[idx] = s
      return { ...state, stages }
    }
    case 'stage_end': {
      const s = { ...stages[event.stageIdx] }
      s.status = 'done'
      s.output = event.output
      s.durationMs = event.durationMs
      stages[event.stageIdx] = s
      return { ...state, stages }
    }
    case 'pipeline_done':
      return { ...state, status: 'done', finalOutput: event.finalOutput }
    case 'pipeline_error': {
      if (event.stageIdx >= 0 && event.stageIdx < stages.length) {
        stages[event.stageIdx] = { ...stages[event.stageIdx], status: 'error' }
      }
      return { ...state, status: 'error', error: event.error, stages }
    }
    default:
      return state
  }
}

function stageIdxFromSession(runId: string, sessionId: string): number {
  const prefix = `${runId}_stage_`
  if (!sessionId.startsWith(prefix)) return -1
  return parseInt(sessionId.slice(prefix.length), 10)
}
