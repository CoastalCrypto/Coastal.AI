import { randomUUID } from 'node:crypto'
import { AgentRegistry } from '../agents/registry.js'
import { ModelRouter } from '../models/router.js'
import { ToolRegistry } from '../tools/registry.js'
import { PermissionGate } from '../agents/permission-gate.js'
import { ActionLog } from '../agents/action-log.js'
import { PersonaManager } from '../persona/manager.js'
import { AgentSession } from '../agents/session.js'
import { AgenticLoop } from '../agents/loop.js'
import { eventBus } from '../events/bus.js'
import type { SteerQueue } from './steer-queue.js'
import type { PipelineStore, SavedStageConfig } from './store.js'

export interface RunStage {
  agentId: string
  modelPref?: string
  type?: 'agent' | 'ralph-loop'
  loopBack?: { toStageIdx: number; condition: string; maxIterations: number }
}

export interface ActiveRun {
  runId: string
  status: 'running' | 'done' | 'error' | 'aborted'
  stageIdx: number
  abort: () => void
  startedAt: number
}

const COMPLETED_RUN_TTL_MS = 60 * 60 * 1000 // 1 hour
const MAX_COMPLETED_RUNS = 200

export class AsyncPipelineRunner {
  private runs = new Map<string, ActiveRun>()

  constructor(
    private registry: AgentRegistry,
    private router: ModelRouter,
    private toolRegistry: ToolRegistry,
    private gate: PermissionGate,
    private log: ActionLog,
    private personaMgr: PersonaManager,
    private steerQueue: SteerQueue,
    private store?: PipelineStore,
  ) {}

  async start(stages: RunStage[], input: string, pipelineId?: string, pipelineName?: string): Promise<{ runId: string }> {
    const runId = randomUUID()
    const controller = new AbortController()
    const run: ActiveRun = {
      runId,
      status: 'running',
      stageIdx: 0,
      abort: () => controller.abort(),
      startedAt: Date.now(),
    }
    this.runs.set(runId, run)
    await this.store?.createRun(runId, pipelineId, pipelineName ?? 'Ad-hoc run', stages.length, run.startedAt)

    // Fire and forget — errors are published as pipeline_error events
    this._execute(run, stages, input, pipelineId, controller.signal).catch(() => {})

    return { runId }
  }

  getStatus(runId: string): ActiveRun | undefined {
    return this.runs.get(runId)
  }

  abort(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run || run.status !== 'running') return false
    run.abort()
    run.status = 'aborted'
    return true
  }

  private async _execute(
    run: ActiveRun,
    stages: RunStage[],
    initialInput: string,
    pipelineId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const { runId } = run
    const startedAt = run.startedAt
    eventBus.publish({ type: 'pipeline_start', ts: Date.now(), runId, pipelineId, stageCount: stages.length })

    let currentInput = initialInput
    let stageIdx = 0
    // Track loop iterations per stage
    const loopIterations = new Map<number, number>()

    try {
      while (stageIdx < stages.length) {
        if (signal.aborted) break

        const stage = stages[stageIdx]

        // Ralph Loop stage: skip execution (cron registration is done at save time)
        if (stage.type === 'ralph-loop') { stageIdx++; continue }

        const agentConfig = this.registry.get(stage.agentId)
        if (!agentConfig) throw new Error(`Agent not found: ${stage.agentId}`)

        const iteration = loopIterations.get(stageIdx) ?? 0
        run.stageIdx = stageIdx
        eventBus.publish({ type: 'stage_start', ts: Date.now(), runId, stageIdx, agentId: agentConfig.id, agentName: agentConfig.name, iteration })

        const toolDefs = this.toolRegistry.getDefinitionsFor(agentConfig.tools)
        const session = new AgentSession(agentConfig, toolDefs, this.personaMgr.get())
        const loop = new AgenticLoop(this.router, this.toolRegistry, this.gate, this.log)

        const stageStart = Date.now()
        const result = await loop.run(
          session, currentInput, `${runId}_stage_${stageIdx}`, [],
          undefined, signal, undefined, this.steerQueue, runId,
        )

        const output = result.reply
        eventBus.publish({ type: 'stage_end', ts: Date.now(), runId, stageIdx, agentId: agentConfig.id, output, durationMs: Date.now() - stageStart, iteration })

        // Check loop-back condition
        const loopBack = stage.loopBack
        if (loopBack) {
          const currentIteration = loopIterations.get(stageIdx) ?? 0
          const conditionMet = !output.toLowerCase().includes(loopBack.condition.toLowerCase())
          if (conditionMet && currentIteration < loopBack.maxIterations - 1) {
            loopIterations.set(stageIdx, currentIteration + 1)
            eventBus.publish({ type: 'loop_iteration', ts: Date.now(), runId, fromStageIdx: stageIdx, toStageIdx: loopBack.toStageIdx, iteration: currentIteration + 1, condition: loopBack.condition })
            stageIdx = loopBack.toStageIdx
            currentInput = output
            continue
          }
        }

        currentInput = output
        stageIdx++
      }

      const finalStatus = signal.aborted ? 'aborted' : 'done'
      const totalMs = Date.now() - startedAt
      run.status = finalStatus
      eventBus.publish({ type: 'pipeline_done', ts: Date.now(), runId, finalOutput: currentInput, totalDurationMs: totalMs })
      await this.store?.finalizeRun(runId, finalStatus, { finalOutput: currentInput, totalDurationMs: totalMs })
    } catch (e: unknown) {
      run.status = 'error'
      const error = e instanceof Error ? e.message : String(e)
      eventBus.publish({ type: 'pipeline_error', ts: Date.now(), runId, stageIdx: run.stageIdx, error })
      await this.store?.finalizeRun(runId, 'error', { error, totalDurationMs: Date.now() - startedAt })
    } finally {
      this.steerQueue.cleanup(runId)
      this._evictStaleRuns()
    }
  }

  private _evictStaleRuns(): void {
    const cutoff = Date.now() - COMPLETED_RUN_TTL_MS
    for (const [id, run] of this.runs) {
      if (run.status !== 'running' && run.startedAt < cutoff) {
        this.runs.delete(id)
      }
    }
    // Cap total completed entries as a hard backstop
    if (this.runs.size > MAX_COMPLETED_RUNS) {
      const sorted = [...this.runs.entries()]
        .filter(([, r]) => r.status !== 'running')
        .sort((a, b) => a[1].startedAt - b[1].startedAt)
      for (const [id] of sorted.slice(0, this.runs.size - MAX_COMPLETED_RUNS)) {
        this.runs.delete(id)
      }
    }
  }
}
