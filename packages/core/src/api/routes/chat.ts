import type { FastifyInstance } from 'fastify'
import { ModelRouter } from '../../models/router.js'
import { UnifiedMemory } from '../../memory/index.js'
import { AgentRegistry } from '../../agents/registry.js'
import { AgentSession } from '../../agents/session.js'
import { AgenticLoop } from '../../agents/loop.js'
import { PermissionGate } from '../../agents/permission-gate.js'
import { ActionLog } from '../../agents/action-log.js'
import { SkillGapsLog } from '../../agents/skill-gaps.js'
import { ToolRegistry } from '../../tools/registry.js'
import { createBackend } from '../../tools/backends/index.js'
import { BrowserSessionManager } from '../../tools/browser/session-manager.js'
import { McpAdapter } from '../../tools/mcp/adapter.js'
import { PersonaManager } from '../../persona/manager.js'
import { ContextStore } from '../../context/store.js'
import { UserModelStore } from '../../persona/user-model.js'
import { loadConfig } from '../../config.js'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join as pathJoin } from 'node:path'

import { McpStore } from '../../tools/mcp/store.js'
import { eventBus } from '../../events/bus.js'

export async function chatRoutes(
  fastify: FastifyInstance,
  opts: { mcpStore: McpStore; gate: PermissionGate; db: Database.Database; sessionsDb: Database.Database; router: ModelRouter; memory: UnifiedMemory; agentRegistry: AgentRegistry; toolRegistry: ToolRegistry; log: ActionLog; skillGaps: SkillGapsLog; personaMgr: PersonaManager; contextStore: ContextStore; userModelStore: UserModelStore },
) {
  const { mcpStore, gate, db, sessionsDb, router, memory, agentRegistry, toolRegistry, log, skillGaps, personaMgr, contextStore, userModelStore } = opts
  const config = loadConfig()

  // Per-session AbortControllers for predictive inference — cancels any in-flight
  // predictive call before spawning the next one, preventing overlapping runs.
  const predControllers = new Map<string, AbortController>()

  // 1. Initialize Dynamic MCP Servers
  const SECRETS_RE = /key|token|secret|password|auth|credential/i
  const baseEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !SECRETS_RE.test(k))
  ) as Record<string, string>

  const activeAdapters: McpAdapter[] = []

  // Only connect MCP servers if NOT running tests
  if (process.env.NODE_ENV !== 'test') {
    const servers = mcpStore.list().filter(s => s.enabled)
    for (const s of servers) {
      const adapter = new McpAdapter(
        s.command,
        s.args,
        { ...baseEnv, ...(s.env || {}) },
        s.id
      )
      adapter.connect(toolRegistry).catch(e => console.error(`MCP Server [${s.name}] failed:`, e))
      activeAdapters.push(adapter)
    }
  }

  fastify.addHook('onClose', async () => {
    for (const a of activeAdapters) await a.close()
  })


  fastify.post<{
    Body: { sessionId?: string; message: string; model?: string; images?: string[] }
  }>('/api/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          sessionId: { type: 'string', maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' },
          message: { type: 'string', minLength: 1, maxLength: 8192 },
          model: { type: 'string' },
          images: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        },
      },
    },
  }, async (req, reply) => {
    const { message, model, images } = req.body
    const sessionId = req.body.sessionId ?? randomUUID()

    const history = await memory.queryHistory({ sessionId, limit: 20 })
    memory.flushOldEntries(sessionId, 20).catch(() => {})
    const messages = history.slice().reverse().map(e => ({ role: e.role as any, content: e.content }))

    // Classify domain via CascadeRouter
    const decision = await router.cascade.route(message)
    const agent = agentRegistry.getByDomain(decision.domain) ?? agentRegistry.get('general')!
    const toolDefs = toolRegistry.getDefinitionsFor(agent.tools)
    const contextDocs = contextStore.listForAgent(agent.id)
    const session = new AgentSession(agent, toolDefs, personaMgr.get(), contextDocs, userModelStore, config.agentTrustLevel)

    // Pending approval callback — sends WS event to client
    const pendingApprovals = new Map<string, string>()
    const onApprovalNeeded = (approvalId: string, agentName: string, toolName: string, cmd: string) => {
      pendingApprovals.set(approvalId, toolName)
      fastify.websocketServer?.clients.forEach((client: any) => {
        if (client._sessionId === sessionId) {
          client.send(JSON.stringify({ type: 'approval_request', approvalId, agentName, toolName, cmd }))
        }
      })
    }

    const loop = new AgenticLoop(router.ollama, toolRegistry, gate, log, onApprovalNeeded, skillGaps)
    const sessionStart = Date.now()
    eventBus.publish({ type: 'session_start', ts: sessionStart, sessionId, agentId: agent.id })
    const result = await loop.run(session, message, sessionId, messages, undefined, undefined, images)
    eventBus.publish({ type: 'session_complete', ts: Date.now(), sessionId, agentId: agent.id, durationMs: Date.now() - sessionStart, toolCallCount: 0 })

    await memory.write({ id: randomUUID(), sessionId, role: 'user', content: message, timestamp: Date.now() }, decision.signals.retention)
    await memory.write({ id: randomUUID(), sessionId, role: 'assistant', content: result.reply, timestamp: Date.now() }, 'useful')

    // Upsert session record with auto-generated title from first user message
    const title = message.slice(0, 80).replace(/\s+/g, ' ').trim()
    const now = Date.now()
    sessionsDb.prepare(`
      INSERT INTO sessions (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
    `).run(sessionId, title.slice(0, 120), now, now)

    // START PREDICTIVE THREAD
    // Abort any in-flight predictive call for this session before starting a new one
    predControllers.get(sessionId)?.abort()
    const predCtrl = new AbortController()
    predControllers.set(sessionId, predCtrl)
    setTimeout(async () => {
      try {
        const predictiveAgent = agentRegistry.get('general')!
        const predSession = new AgentSession(predictiveAgent, toolDefs, personaMgr.get(), [], null, config.agentTrustLevel)
        const prompt = `Based on the latest user message "${message}" and your reply "${result.reply}", proactively predict the single most helpful next action or follow-up question the user might need. Respond ONLY with a short, actionable phrasing (max 6 words). Do not execute tools. Just provide the suggestion string.`
        const predLoop = new AgenticLoop(router.ollama, toolRegistry, gate, log, onApprovalNeeded)
        const pResult = await predLoop.run(predSession, prompt, sessionId, [], undefined, predControllers.get(sessionId)?.signal)
        fastify.websocketServer?.clients.forEach((client: any) => {
          if (client._sessionId === sessionId) {
            client.send(JSON.stringify({ type: 'proactive_suggestion', suggestion: pResult.reply, sessionId }))
          }
        })
      } catch (e) {
        console.error('Prediction failed', e)
      }
    }, 1000)

    return reply.send({ sessionId, reply: result.reply, domain: result.domain })
  })
}
