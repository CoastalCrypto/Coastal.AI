import type { FastifyInstance } from 'fastify'
import type { CycleStore } from '../../architect/cycle-store.js'

export interface CallbackRouteDeps {
  cycleStore: CycleStore
  verifyToken: (token: string) => { cycleId: string; gate: string; decision: string; expiresAt: number } | null
}

// verifyToken's real implementation (verify-callback-token.ts) constrains
// decision to a fixed enum, so this can't carry attacker-controlled HTML
// today — but that constraint lives in a different file, and this route has
// no way to know it still holds. Escaping here is a one-line insurance
// policy against the enum ever growing a value with markup in it, or
// against a future verifyToken implementation that doesn't validate as
// tightly.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export async function architectCallbackRoutes(app: FastifyInstance, deps: CallbackRouteDeps): Promise<void> {
  // POST for API clients
  app.post<{ Params: { token: string } }>('/api/admin/architect/callbacks/:token', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const payload = deps.verifyToken(req.params.token)
    if (!payload) return reply.code(410).send({ error: 'expired_or_invalid', message: 'This link has expired or is invalid.' })
    deps.cycleStore.recordApproval(payload.cycleId, {
      gate: payload.gate,
      decision: payload.decision,
      decidedBy: 'callback',
    })
    return { ok: true, decision: payload.decision }
  })

  // GET for browser link clicks (Telegram taps etc.)
  app.get<{ Params: { token: string } }>('/api/admin/architect/callbacks/:token', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const payload = deps.verifyToken(req.params.token)
    if (!payload) return reply.code(410).type('text/html').send('<h1>Link Expired</h1><p>This approval link has expired or is invalid.</p>')
    deps.cycleStore.recordApproval(payload.cycleId, {
      gate: payload.gate,
      decision: payload.decision,
      decidedBy: 'callback',
    })
    return reply.type('text/html').send(`<h1>Done</h1><p>Decision: ${escapeHtml(payload.decision)}</p><p><a href="/">Back to dashboard</a></p>`)
  })
}
