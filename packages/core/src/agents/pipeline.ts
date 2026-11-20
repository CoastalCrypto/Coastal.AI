import type { AgentRegistry } from './registry.js'
import type { ModelRouter } from '../models/router.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { PermissionGate } from './permission-gate.js'
import type { ActionLog } from './action-log.js'
import type { PersonaManager } from '../persona/manager.js'
import { AgentSession } from './session.js'
import { AgenticLoop } from './loop.js'
import { randomUUID } from 'node:crypto'

export interface PipelineStage {
  agentId: string
  modelPref?: string
}

export interface PipelineStageResult {
  agentId: string
  agentName: string
  input: string
  output: string
  durationMs: number
}

export interface PipelineResult {
  pipelineId: string
  stages: PipelineStageResult[]
  finalOutput: string
  totalDurationMs: number
}

export class AgentPipeline {
  constructor(
    private registry: AgentRegistry,
    private router: ModelRouter,
    private toolRegistry: ToolRegistry,
    private gate: PermissionGate,
    private log: ActionLog,
    private personaMgr: PersonaManager,
  ) {}

  async run(stages: PipelineStage[], initialInput: string, sessionId?: string): Promise<PipelineResult> {
    if (stages.length < 1) throw new Error('Pipeline must have at least one stage')
    const pipelineId = randomUUID()
    const sid = sessionId ?? `pipeline_${pipelineId}`
    const stageResults: PipelineStageResult[] = []
    let currentInput = initialInput
    const pipelineStart = Date.now()

    for (const stage of stages) {
      const agentConfig = this.registry.get(stage.agentId)
      if (!agentConfig) throw new Error(`Agent not found: ${stage.agentId}`)
      if (!agentConfig.active) throw new Error(`Agent is offline: ${stage.agentId}`)

      const toolDefs = this.toolRegistry.getDefinitionsFor(agentConfig.tools)
      const session = new AgentSession(agentConfig, toolDefs, this.personaMgr.get())
      const loop = new AgenticLoop(this.router, this.toolRegistry, this.gate, this.log)

      const stageStart = Date.now()
      const result = await loop.run(session, currentInput, `${sid}_stage_${stageResults.length}`, [])

      stageResults.push({
        agentId: agentConfig.id,
        agentName: agentConfig.name,
        input: currentInput,
        output: result.reply,
        durationMs: Date.now() - stageStart,
      })

      currentInput = result.reply
    }

    return {
      pipelineId,
      stages: stageResults,
      finalOutput: currentInput,
      totalDurationMs: Date.now() - pipelineStart,
    }
  }
}
