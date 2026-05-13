import type { FastifyInstance } from 'fastify'
import { ModelRouter } from '../../models/router.js'
import { UnifiedMemory } from '../../memory/index.js'
import { AgentRegistry } from '../../agents/registry.js'
import { AgentSession } from '../../agents/session.js'
import { AgenticLoop } from '../../agents/loop.js'
import { PermissionGate } from '../../agents/permission-gate.js'
import { ActionLog } from '../../agents/action-log.js'
import { ToolRegistry } from '../../tools/registry.js'
import { createBackend } from '../../tools/backends/index.js'
import { PersonaManager } from '../../persona/manager.js'
import { loadConfig } from '../../config.js'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export async function streamRoutes(
  fastify: FastifyInstance,
  opts: { gate: PermissionGate; db: Database.Database; sessionsDb: Database.Database; router: ModelRouter; memory: UnifiedMemory; agentRegistry: any; toolRegistry: ToolRegistry; log: ActionLog; personaMgr: PersonaManager },
) {
  const { gate, db, sessionsDb, router, memory, agentRegistry, toolRegistry, log, personaMgr } = opts
  const config = loadConfig()

  // POST /api/chat/stream — SSE streaming chat
  fastify.post<{
    Body: { message: string; sessionId?: string; images?: string[]; agentId?: string }
  }>('/api/chat/stream', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 8192 },
          sessionId: { type: 'string' },
          images: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          agentId: { type: 'string', maxLength: 64 },
        },
      },
    },
  }, async (req, reply) => {
    const { message, images, agentId } = req.body
    const sessionId = req.body.sessionId ?? randomUUID()

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')

    const write = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const history = await memory.queryHistory({ sessionId, limit: 20 })
      const messages = history.slice().reverse().map(e => ({ role: e.role as any, content: e.content }))

      // Binding rules → explicit selection → domain routing
      const sourceHeader = req.headers['x-source']
      const source = typeof sourceHeader === 'string' ? sourceHeader : (Array.isArray(sourceHeader) ? sourceHeader[0] : null) ?? null
      const agent = agentRegistry.findBindingMatch(sessionId, source)
        ?? (agentId ? agentRegistry.get(agentId) : null)
        ?? agentRegistry.getByDomain((await router.cascade.route(message)).domain)
        ?? agentRegistry.get('general')!
      write('domain', { domain: agent.id })
      const toolDefs = toolRegistry.getDefinitionsFor(agent.tools)
      const session = new AgentSession(agent, toolDefs, personaMgr.get(), [], null, config.agentTrustLevel)

      const onApprovalNeeded = (approvalId: string, agentName: string, toolName: string, cmd: string) => {
        write('approval', { approvalId, agentName, toolName, cmd })
      }

      let streamed = false
      const onToken = (token: string) => {
        streamed = true
        write('token', { token })
      }

      const loop = new AgenticLoop(router.ollama, toolRegistry, gate, log, onApprovalNeeded, undefined, onToken)
      const result = await loop.run(session, message, sessionId, messages, undefined, undefined, images)

      // Only send full reply when tokens were NOT streamed (tool-use path, or model returned all at once)
      if (!streamed) {
        write('reply', { reply: result.reply, domain: result.domain })
      }

      await memory.write({ id: randomUUID(), sessionId, role: 'user', content: message, timestamp: Date.now() }, 'useful')
      await memory.write({ id: randomUUID(), sessionId, role: 'assistant', content: result.reply, timestamp: Date.now() }, 'useful')

      // Upsert session title
      const title = message.slice(0, 80).replace(/\s+/g, ' ').trim()
      const internalHost = (config.host === '0.0.0.0' || config.host === '::') ? '127.0.0.1' : config.host
      fetch(`http://${internalHost}:${config.port}/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }).catch(() => {})

      write('done', { sessionId, domain: result.domain })
    } catch (e: unknown) {
      write('error', { message: e instanceof Error ? e.message : String(e) })
    } finally {
      reply.raw.end()
    }

    return reply
  })

  fastify.addHook('onClose', async () => {
    await memory.close()
    router.close()
    agentRegistry.close()
    db.close()
    personaMgr.close()
  })
}
