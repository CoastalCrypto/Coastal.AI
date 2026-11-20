import type { FastifyInstance } from 'fastify'
import type { ModelRouter } from '../../models/router.js'
import type { AgentRegistry } from '../../agents/registry.js'
import type { ToolRegistry } from '../../tools/registry.js'
import { BossAgent } from '../../agents/boss-agent.js'
import { TeamChannel } from '../../agents/team-channel.js'
import { randomUUID } from 'node:crypto'

export interface TeamRouteDeps {
  registry: AgentRegistry
  router: ModelRouter
  toolRegistry: ToolRegistry
}

export async function teamRoutes(fastify: FastifyInstance, opts: TeamRouteDeps) {
  const { registry, router, toolRegistry } = opts
  // In-memory pub/sub bus, local to this route group — no persistent state
  // of its own, so unlike router/registry/toolRegistry there is nothing
  // here that benefits from being shared with the rest of the app.
  const channel = new TeamChannel()

  fastify.post<{
    Body: { task: string; sessionId?: string }
    Reply: { reply: string; subtaskCount: number; subtasks: Array<{ subtaskId: string; reply: string }> }
  }>('/api/team/run', {
    schema: {
      body: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string' },
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { task, sessionId = randomUUID() } = req.body
    const boss = new BossAgent(router, registry, channel, toolRegistry)
    const result = await boss.run(task, sessionId)
    return reply.send(result)
  })
}
