import type { FastifyInstance } from 'fastify'
import type { ModelRouter } from '../../models/router.js'
import type { AgentRegistry } from '../../agents/registry.js'
import { TeamChannel } from '../../agents/team-channel.js'
import { NoteStore } from '../../memory/notes.js'
import { DomainClassifier } from '../../routing/domain-classifier.js'
import { runTeamChain } from '../../agents/run-team-chain.js'
import type { TurnRecord } from '../../agents/run-context.js'
import { loadConfig } from '../../config.js'

export interface TeamRouteDeps {
  registry: AgentRegistry
  router: ModelRouter
}

export async function teamRoutes(fastify: FastifyInstance, opts: TeamRouteDeps) {
  const { registry, router } = opts
  const config = loadConfig()
  // In-memory pub/sub bus, local to this route group — no persistent state
  // of its own, so unlike router/registry there is nothing here that
  // benefits from being shared with the rest of the app. Same reasoning for
  // noteStore (a separate team-notes substrate, not the shared notes.db
  // UnifiedMemory already owns — deliberately its own store) and classifier
  // (a thin, stateless OllamaClient wrapper — ModelRouter's own
  // CascadeRouter already builds one for cascade routing; a second instance
  // here costs nothing and isn't the kind of duplication worth sharing).
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
    // sessionId reserved: not yet threaded into runTeamChain — see spec's "Out of scope"
    const trace = await runTeamChain(
      {
        router,
        registry,
        noteStore,
        channel,
        classifier,
        defaultModel: config.defaultModel,
        judgeModel: config.quantRouterModel,
        turnBudget: config.teamTurnBudget,
        chainTimeoutMs: config.teamChainTimeoutMs,
      },
      task,
    )
    return reply.send({ trace })
  })

  fastify.addHook('onClose', async () => {
    noteStore.close()
  })
}
