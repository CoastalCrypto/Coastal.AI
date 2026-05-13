import type { OllamaClient } from '../models/ollama.js'
import type { AgentSession, ChatMessage } from './session.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { PermissionGate } from './permission-gate.js'
import type { ActionLog } from './action-log.js'
import type { LoopResult, GateDecision } from './types.js'
import type { SkillGapsLog } from './skill-gaps.js'
import type { SteerQueue } from '../pipeline/steer-queue.js'
import { runBackgroundReview } from './learning-thread.js'
import { IterationBudget } from './iteration-budget.js'
import { eventBus } from '../events/bus.js'

const MAX_TURNS = () => { const n = Number(process.env.CC_AGENT_MAX_TURNS ?? 10); return (isNaN(n) || n < 1) ? 10 : n }
const MAX_RESULT_CHARS = () => { const n = Number(process.env.CC_TOOL_RESULT_MAX_CHARS ?? 4000); return (isNaN(n) || n < 1) ? 4000 : n }

export class AgenticLoop {
  private skillGaps?: SkillGapsLog

  constructor(
    private ollama: OllamaClient,
    private registry: ToolRegistry,
    private gate: PermissionGate,
    private log: ActionLog,
    private onApprovalNeeded?: (approvalId: string, agentName: string, toolName: string, cmd: string) => void,
    skillGaps?: SkillGapsLog,
    private onToken?: (token: string) => void,
  ) {
    this.skillGaps = skillGaps
  }

  async run(
    session: AgentSession,
    userMessage: string,
    sessionId: string,
    history: ChatMessage[],
    budget?: IterationBudget,
    signal?: AbortSignal,
    images?: string[],
    steerQueue?: SteerQueue,
    runId?: string,
  ): Promise<LoopResult> {
    const messages: ChatMessage[] = session.buildMessages(userMessage, history)
    if (images?.length) {
      const last = messages[messages.length - 1]
      if (last.role === 'user') last.images = images
    }
    const iterBudget = budget ?? new IterationBudget(MAX_TURNS())

    try {
      while (!iterBudget.isExhausted) {
        if (signal?.aborted) {
          const interruptedResult: LoopResult = {
            reply: `${session.actionSummary()}\n\n[Interrupted by parent signal.]`,
            actions: session.actions,
            domain: session.agent.id,
            status: 'interrupted',
          }
          if (this.skillGaps) {
            runBackgroundReview(interruptedResult, sessionId, this.skillGaps).catch(() => {})
          }
          return interruptedResult
        }
        if (!iterBudget.consume()) break

        const { content, toolCalls } = await this.ollama.chatWithTools(
          session.agent.modelPref ?? process.env.CC_DEFAULT_MODEL ?? 'llama3.2',
          messages,
          session.toolSchemas,
        )

        if (!toolCalls.length) {
          // If streaming, the content here is empty — stream the final reply token-by-token
          let finalContent = content
          if (this.onToken && !content) {
            const model = session.agent.modelPref ?? process.env.CC_DEFAULT_MODEL ?? 'llama3.2'
            for await (const token of this.ollama.chatStream(model, messages)) {
              this.onToken(token)
              finalContent += token
            }
          }
          const completeResult: LoopResult = {
            reply: finalContent + session.actionSummary(),
            actions: session.actions,
            domain: session.agent.id,
            status: 'complete',
          }
          if (this.skillGaps) {
            runBackgroundReview(completeResult, sessionId, this.skillGaps).catch(() => {})
          }
          return completeResult
        }

        // Push assistant message with tool_calls
        messages.push({
          role: 'assistant',
          content,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            function: { name: tc.name, arguments: tc.args },
          })),
        })

        // Separate reads and writes for parallel vs sequential execution
        const hasWrite = toolCalls.some(tc => !this.registry.isReversible(tc.name, tc.args))

        if (!hasWrite) {
          // All reads — run concurrently
          const results = await Promise.all(toolCalls.map(tc => this.executeOne(tc, session, sessionId)))
          for (const { tc, output } of results) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
          }
        } else {
          // Sequential — preserve ordering for writes
          for (const tc of toolCalls) {
            const { output } = await this.executeOne(tc, session, sessionId)
            messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
          }
        }

        // Drain any steering messages from the user and inject as user turns
        if (steerQueue && runId) {
          const steered = steerQueue.drain(runId)
          for (const msg of steered) {
            messages.push({ role: 'user', content: `[Live steering]: ${msg}` })
            eventBus.publish({ type: 'stage_steer', ts: Date.now(), runId, stageIdx: -1, message: msg })
          }
        }

      }

      const budgetResult: LoopResult = {
        reply: `${session.actionSummary()}\n\n[Budget exhausted after ${MAX_TURNS()} maximum turns. Stopping here.]`,
        actions: session.actions,
        domain: session.agent.id,
        status: 'interrupted',
      }
      if (this.skillGaps) {
        runBackgroundReview(budgetResult, sessionId, this.skillGaps).catch(() => {})
      }
      return budgetResult
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const errorResult: LoopResult = {
        reply: `Agent encountered an error: ${msg}`,
        actions: session.actions,
        domain: session.agent.id,
        status: 'error',
        error: msg,
      }
      if (this.skillGaps) {
        runBackgroundReview(errorResult, sessionId, this.skillGaps).catch(() => {})
      }
      return errorResult
    }
  }

  private async executeOne(
    tc: { id: string; name: string; args: Record<string, unknown> },
    session: AgentSession,
    sessionId: string,
  ): Promise<{ tc: typeof tc; output: string }> {
    const start = Date.now()
    const reversible = this.registry.isReversible(tc.name, tc.args)
    const decision = this.gate.evaluate(session.agent.id, tc.name, reversible, session.agent.tools, session.getTrustLevel() ?? undefined)

    if (decision === 'block') {
      const duration = Date.now() - start
      this.log.record({
        sessionId,
        agentId: session.agent.id,
        toolName: tc.name,
        args: tc.args,
        result: 'Blocked: tool not permitted for this agent',
        decision: 'block',
        durationMs: duration,
      })
      session.recordAction({
        tool: tc.name,
        args: tc.args,
        output: 'Error: tool not permitted',
        decision: 'block',
        durationMs: duration,
      })
      return { tc, output: `Error: tool "${tc.name}" is not permitted for agent ${session.agent.name}` }
    }

    if (decision === 'queued') {
      const { approvalId, promise } = this.gate.createPendingApproval()
      this.onApprovalNeeded?.(approvalId, session.agent.name, tc.name, JSON.stringify(tc.args))
      const approval = await promise

      if (approval === 'timeout') {
        const duration = Date.now() - start
        this.log.record({
          sessionId,
          agentId: session.agent.id,
          toolName: tc.name,
          args: tc.args,
          result: 'Approval timed out',
          decision: 'timeout',
          durationMs: duration,
        })
        session.recordAction({
          tool: tc.name,
          args: tc.args,
          output: 'Approval timed out',
          decision: 'timeout',
          durationMs: duration,
        })
        return { tc, output: `Error: approval timed out for tool "${tc.name}"` }
      }

      if (approval !== 'approved') {
        // denied
        const duration = Date.now() - start
        this.log.record({
          sessionId,
          agentId: session.agent.id,
          toolName: tc.name,
          args: tc.args,
          result: 'Denied by user',
          decision: 'denied',
          durationMs: duration,
        })
        session.recordAction({
          tool: tc.name,
          args: tc.args,
          output: 'Denied by user',
          decision: 'denied',
          durationMs: duration,
        })
        return { tc, output: `Tool "${tc.name}" was denied by the user` }
      }
    }

    // Emit tool_call_start
    eventBus.publish({ type: 'tool_call_start', ts: start, sessionId, agentId: session.agent.id, toolName: tc.name, args: tc.args })
    // Emit graph_edge
    eventBus.publish({ type: 'graph_edge', ts: start, source: session.agent.id, target: tc.name, edgeType: 'agent-tool' })

    // Execute the tool
    let raw = ''
    let success = true
    try {
      raw = await this.registry.execute(tc.name, tc.args)
    } catch (e: unknown) {
      raw = `Execution error: ${(e as Error).message}`
      success = false
    }

    const truncated = raw.slice(0, MAX_RESULT_CHARS())
    const duration = Date.now() - start
    const finalDecision: GateDecision = decision === 'queued' ? 'approved' : decision

    // Emit tool_call_end
    eventBus.publish({ type: 'tool_call_end', ts: Date.now(), sessionId, agentId: session.agent.id, toolName: tc.name, durationMs: duration, decision: finalDecision, success })

    this.log.record({
      sessionId,
      agentId: session.agent.id,
      toolName: tc.name,
      args: tc.args,
      result: raw,
      decision: finalDecision,
      durationMs: duration,
    })
    session.recordAction({
      tool: tc.name,
      args: tc.args,
      output: truncated,
      decision: finalDecision,
      durationMs: duration,
    })

    return { tc, output: truncated }
  }
}
