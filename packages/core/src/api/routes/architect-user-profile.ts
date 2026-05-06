import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { UserProfileStore } from '../../architect/user-profile/store.js'
import {
  PLAN_VERBOSITIES, AUTO_APPROVE_THRESHOLDS, TEST_STRICTNESSES,
  GATE_POLICIES, TONES, ITERATION_PATIENCES, RISK_POSTURES,
} from '../../architect/user-profile/store.js'
import { PREFERENCE_QUESTIONS, answersToProfilePatch } from '../../architect/user-profile/questions.js'

export interface UserProfileRouteDeps {
  profileStore: UserProfileStore
}

const profilePatchSchema = z.object({
  planVerbosity: z.enum(PLAN_VERBOSITIES).optional(),
  autoApproveThreshold: z.enum(AUTO_APPROVE_THRESHOLDS).optional(),
  testStrictness: z.enum(TEST_STRICTNESSES).optional(),
  gatePolicy: z.enum(GATE_POLICIES).optional(),
  tone: z.enum(TONES).optional(),
  iterationPatience: z.enum(ITERATION_PATIENCES).optional(),
  riskPosture: z.enum(RISK_POSTURES).optional(),
}).strict()

const wizardSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
})

export async function architectUserProfileRoutes(
  app: FastifyInstance,
  deps: UserProfileRouteDeps,
): Promise<void> {
  const { profileStore } = deps

  app.get('/api/admin/architect/user-profile', async () => {
    return profileStore.getDefault()
  })

  app.get('/api/admin/architect/user-profile/questions', async () => {
    return { questions: PREFERENCE_QUESTIONS }
  })

  app.put(
    '/api/admin/architect/user-profile',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = profilePatchSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      }
      const updated = profileStore.update('default', parsed.data)
      if (!updated) return reply.code(404).send({ error: 'not_found' })
      return updated
    },
  )

  app.post(
    '/api/admin/architect/user-profile/wizard',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = wizardSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      }
      const patch = answersToProfilePatch(parsed.data.answers)
      const updated = profileStore.update('default', patch)
      if (!updated) return reply.code(404).send({ error: 'not_found' })
      return { profile: updated, applied: Object.keys(patch) }
    },
  )
}
