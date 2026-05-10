import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UserProfileStore } from '../../architect/user-profile/store.js'
import {
  ARCHITECT_MODES, applyMode, deriveMode, type ModeOrCustom,
} from '../../architect/user-profile/modes.js'

export interface ControlRouteDeps {
  dataDir: string
  // Profile store is the single source of truth for `mode`. GET /status
  // derives the mode name from the engagement-axis knobs via deriveMode().
  profileStore: UserProfileStore
}

const modeSchema = z.object({
  mode: z.enum([...ARCHITECT_MODES, 'custom']),
})

export async function architectControlRoutes(app: FastifyInstance, deps: ControlRouteDeps): Promise<void> {
  const { dataDir, profileStore } = deps
  const pidFile = join(dataDir, '.architect-pid')

  function getState(): { power: 'on' | 'off'; mode: ModeOrCustom } {
    const power = existsSync(pidFile) ? 'on' : 'off'
    const mode = deriveMode(profileStore.getDefault())
    return { power, mode }
  }

  app.get('/api/admin/architect/status', async () => {
    return getState()
  })

  app.post('/api/admin/architect/power', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const powerSchema = z.object({ state: z.enum(['on', 'off']) })
    const parsed = powerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
    const { state } = parsed.data
    if (state === 'off' && existsSync(pidFile)) {
      writeFileSync(join(dataDir, '.architect-shutdown'), '1')
    }
    return { ok: true, power: state }
  })

  app.post('/api/admin/architect/mode', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = modeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
    const { mode } = parsed.data

    // Fan out the preset into the profile (no-op for 'custom').
    applyMode(profileStore, 'default', mode)

    return { ok: true, mode }
  })

  app.post('/api/admin/architect/run-now', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (_req, reply) => {
    writeFileSync(join(dataDir, '.architect-run-now'), '1')
    return { ok: true, message: 'Tick requested' }
  })
}
