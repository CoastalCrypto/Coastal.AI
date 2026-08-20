import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { ModelRouter } from '../../models/router.js'
import { AgentRegistry } from '../../agents/registry.js'
import { TeamChannel } from '../../agents/team-channel.js'
import { NoteStore } from '../../memory/notes.js'
import { DomainClassifier } from '../../routing/domain-classifier.js'
import { runTeamChain } from '../../agents/run-team-chain.js'
import type { TurnRecord } from '../../agents/run-context.js'
import { loadConfig } from '../../config.js'

export async function teamRoutes(fastify: FastifyInstance) {
  const config = loadConfig()
  const router = new ModelRouter({ ollamaUrl: config.ollamaUrl, vllmUrl: config.vllmUrl, airllmUrl: config.airllmUrl, defaultModel: config.defaultModel })
  const agentRegistry = new AgentRegistry(`${config.dataDir}/agents.db`)
  const channel = new TeamChannel()
  const noteStore = new NoteStore({ dataDir: `${config.dataDir}/team-notes` })
  const classifier = new DomainClassifier({
    ollamaUrl: config.ollamaUrl,
    routerModel: config.quantRouterModel,
    confidenceThreshold: config.routerConfidence,
  })

  fastify.post<{
    Body: { task: string; sessionId?: string }
    Reply: { trace: TurnRecord[] }
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
    const { task } = req.body
    const sessionId = req.body.sessionId ?? randomUUID()
    void sessionId // reserved: not yet threaded into runTeamChain — see spec's "Out of scope"
    const trace = await runTeamChain(
      { router, registry: agentRegistry, noteStore, channel, classifier, defaultModel: config.defaultModel },
      task,
    )
    return reply.send({ trace })
  })

  fastify.addHook('onClose', async () => {
    router.close()
    agentRegistry.close()
    noteStore.close()
  })
}
