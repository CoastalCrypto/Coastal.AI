import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { healthRoutes } from './api/routes/health.js'
import { wsRoutes } from './api/routes/ws.js'
import { consumeTicket } from './api/sse-ticket.js'
import { isPublicRoute, requiredRoleFor, satisfiesRole } from './api/auth-policy.js'
import { agentEventsRoute } from './api/routes/agent-events.js'
import { graphQLRoutes } from './api/routes/graphql.js'
import { chatRoutes } from './api/routes/chat.js'
import { adminActionsRoutes } from './api/routes/admin-actions.js'
import { adminRoutes, validateSessionToken } from './api/routes/admin.js'
import { architectRoutes } from './api/routes/architect.js'
import { architectCycleRoutes } from './api/routes/architect-cycles.js'
import { architectControlRoutes } from './api/routes/architect-controls.js'
import { architectInsightRoutes } from './api/routes/architect-insights.js'
import { architectReceiptRoutes } from './api/routes/architect-receipts.js'
import { architectCallbackRoutes } from './api/routes/architect-callbacks.js'
import { architectSSERoutes } from './api/routes/architect-events-sse.js'
import { architectUserProfileRoutes } from './api/routes/architect-user-profile.js'
import { noteRoutes } from './api/routes/notes.js'
import { verifyCallbackToken } from './architect/verify-callback-token.js'
import { agentRoutes } from './api/routes/agents.js'
import { agentMemoryRoutes } from './api/routes/agent-memory.js'
import { teamRoutes } from './api/routes/team.js'
import { personaRoutes } from './api/routes/persona.js'
import { systemRoutes } from './api/routes/system.js'
import { sessionRoutes } from './api/routes/sessions.js'
import { uploadRoutes } from './api/routes/upload.js'
import { streamRoutes } from './api/routes/stream.js'
import { pipelineRoutes } from './api/routes/pipeline.js'
import { eventRoutes } from './api/routes/events.js'
import { analyticsRoutes } from './api/routes/analytics.js'
import { toolRoutes } from './api/routes/tools.js'
import { channelRoutes } from './api/routes/channels.js'
import { userRoutes } from './api/routes/users.js'
import { cronRoutes } from './api/routes/crons.js'
import { skillRoutes } from './api/routes/skills.js'
import { skillPackRoutes } from './api/routes/skill-packs.js'
import { mcpRoutes } from './api/routes/mcp.js'
import { searchRoutes } from './api/routes/search.js'
import { contextRoutes } from './api/routes/context.js'
import { userModelRoutes } from './api/routes/user-model.js'
import { knowledgeRoutes } from './api/routes/knowledge.js'
import { AsyncPipelineRunner } from './pipeline/runner.js'
import type { UserRole } from './users/store.js'
import multipart from '@fastify/multipart'
import { timingSafeEqual } from 'node:crypto'
import { createAppContext } from './app-context.js'

export async function buildServer() {
  // maxParamLength raised to 500 to support base64url-encoded callback tokens
  // (default is 100, which is too short for JSON payloads embedded in tokens).
  const fastify = Fastify({ logger: false, maxParamLength: 500 })
  const ctx = await createAppContext()
  const { config, adminToken, userStore } = ctx

  // Shared by the onRequest hook below and by the /ws/session first-message
  // handshake (wsRoutes) — a WebSocket upgrade can't be checked by this hook
  // the way a normal fetch() can, so it does its own auth using this exact
  // same session-resolution logic, kept in one place so the two surfaces
  // can't drift apart. Resolves to the caller's role rather than a bare
  // ok/fail — the hook enforces the per-route minimum role on top of this.
  function checkSessionAuth(token: string): { ok: true; role: UserRole } | { ok: false; reason: 'invalid' | 'password_change_required' } {
    if (!token) return { ok: false, reason: 'invalid' }
    // Legacy admin session token (issued by /api/admin/login) — full admin.
    if (validateSessionToken(adminToken, token)) return { ok: true, role: 'admin' }
    // User session token (issued by /api/auth/login) — role is whatever the
    // account holds. A must-change-password account (the seeded default
    // admin/admin, or any account an admin just reset) is blocked from
    // every route this hook gates until the password is actually changed —
    // /api/auth/me and /api/auth/password are public routes precisely so
    // that changing it stays reachable. This is a live DB check, not
    // something embedded in the token, so it takes effect immediately.
    const claims = userStore.verifySessionToken(token)
    if (!claims) return { ok: false, reason: 'invalid' }
    const user = userStore.get(claims.userId)
    if (user?.mustChangePassword) return { ok: false, reason: 'password_change_required' }
    return { ok: true, role: claims.role }
  }

  fastify.addHook('onRequest', async (req, reply) => {
    // CORS preflight must bypass auth so the browser can complete the handshake.
    // The @fastify/cors plugin replies to OPTIONS with the proper Access-Control-* headers.
    if (req.method === 'OPTIONS') return
    if (isPublicRoute(req.url)) return
    // Every /ws/* route is a WebSocket upgrade, not a normal request/response
    // cycle — a browser's native WebSocket API can't attach a custom header
    // to the upgrade handshake, so these authenticate themselves via their
    // own first-message handshake instead (handleSessionWs, agent-events'
    // equivalent), unconditionally. Gating the upgrade request itself here
    // would 401 the handshake before it can even start.
    if (req.url.startsWith('/ws/')) return

    // Deny by default, at every bind address — see api/auth-policy.ts. A
    // route reaches this point only if it isn't in PUBLIC_ROUTES, so every
    // one of them needs a valid session carrying at least the role
    // requiredRoleFor() assigns it (falling through to admin-only when
    // nothing matches).
    const required = requiredRoleFor(req.method, req.url)

    // 1. Raw admin token (legacy / CLI / internal service calls, e.g. the
    //    cron scheduler's self-call to /api/chat). Admin outranks every
    //    requirement, so this is a flat bypass once the token matches.
    const rawHeader = req.headers['x-admin-token'] ?? ''
    const raw = typeof rawHeader === 'string' ? rawHeader : rawHeader[0] ?? ''
    if (raw) {
      const a = Buffer.from(raw, 'utf8')
      const b = Buffer.from(adminToken, 'utf8')
      if (a.length === b.length && timingSafeEqual(a, b)) return
    }

    const sessionHeader = req.headers['x-admin-session'] ?? ''
    const session = typeof sessionHeader === 'string' ? sessionHeader : sessionHeader[0] ?? ''
    if (session) {
      const result = checkSessionAuth(session)
      if (result.ok) {
        if (satisfiesRole(result.role, required)) return
        console.warn(`[auth] 403 ${req.method} ${req.url} — role '${result.role}' below required '${required}'`)
        return reply.status(403).send({ error: 'forbidden', message: `Requires ${required} role or higher.` })
      }
      if (result.reason === 'password_change_required') {
        return reply.status(403).send({ error: 'password_change_required', message: 'Default password must be changed before continuing.' })
      }
      console.warn(`[auth] 401 ${req.method} ${req.url} — session present but invalid (prefix=${session.slice(0, 3)})`)
    } else if (req.method === 'GET' && required === 'viewer') {
      // EventSource can't set headers at all — a viewer-level GET route may
      // instead present a short-lived, single-use ticket minted via an
      // authenticated POST just before connecting (see sse-ticket.ts). A
      // ticket carries no role of its own, so it is accepted only where the
      // route's own requirement is already the lowest rank.
      const queryTicket = (req.query as Record<string, string> | undefined)?.ticket
      const ticket = typeof queryTicket === 'string' ? queryTicket : ''
      if (ticket && consumeTicket(ticket)) return
      console.warn(`[auth] 401 ${req.method} ${req.url} — no session token in x-admin-session header`)
    } else {
      console.warn(`[auth] 401 ${req.method} ${req.url} — no session token in x-admin-session header`)
    }

    return reply.status(401).send({ error: 'Unauthorized' })
  })

  const allowedOrigins = process.env.CC_CORS_ORIGINS?.split(',').map(o => o.trim())
    ?? ['http://localhost:5173', 'http://127.0.0.1:5173']
  await fastify.register(cors, { origin: allowedOrigins })
  await fastify.register(rateLimit, {
    global: false, // opt-in per route
  })
  await fastify.register(websocket)
  // Multipart is registered ONCE here so both upload and knowledge ingest
  // can share `req.file()`. Each route was previously re-registering the
  // plugin, which Fastify rejects (FST_ERR_DEC_ALREADY_PRESENT) and broke
  // the graph-side knowledge upload. The 25MB ceiling matches the larger
  // of the two limits; each route still enforces its own size check.
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
  await fastify.register(healthRoutes)
  await fastify.register(wsRoutes, {
    validateSession: (token: string) => {
      const result = checkSessionAuth(token)
      return result.ok && satisfiesRole(result.role, requiredRoleFor('GET', '/ws/session'))
    },
  })
  await fastify.register(adminRoutes)

  await fastify.register(agentEventsRoute, {
    registry: ctx.agentRegistry,
    channelManager: ctx.channelManager,
    db: ctx.db,
    feedbackStore: ctx.edgeFeedbackStore,
    pipelineStore: ctx.pipelineStore,
    validateSession: (token: string) => {
      if (validateSessionToken(adminToken, token)) return true
      const claims = userStore.verifySessionToken(token)
      return claims !== null
    }
  })
  // Register GraphQL endpoint for agent dependency analysis
  await fastify.register(graphQLRoutes, { registry: ctx.agentRegistry })
  await fastify.register(agentRoutes, { registry: ctx.agentRegistry, gate: ctx.gate })
  await fastify.register(agentMemoryRoutes, { registry: ctx.agentRegistry, db: ctx.db })
  await fastify.register(adminActionsRoutes)

  await fastify.register(architectRoutes, { store: ctx.architectStore })
  await fastify.register(architectCycleRoutes, { cycleStore: ctx.cycleStore, workStore: ctx.architectStore })
  await fastify.register(architectControlRoutes, { dataDir: config.dataDir, profileStore: ctx.userProfileStore })
  await fastify.register(architectUserProfileRoutes, { profileStore: ctx.userProfileStore })
  await fastify.register(architectInsightRoutes, { cycleStore: ctx.cycleStore, workStore: ctx.architectStore })
  await fastify.register(architectReceiptRoutes, { cycleStore: ctx.cycleStore })
  await fastify.register(architectCallbackRoutes, {
    cycleStore: ctx.cycleStore,
    verifyToken: (token: string) => verifyCallbackToken(ctx.callbackKey, token),
  })
  await fastify.register(architectSSERoutes, { db: ctx.architectDb })

  await fastify.register(teamRoutes, {
    registry: ctx.agentRegistry,
    router: ctx.modelRouter,
    toolRegistry: ctx.pipelineToolRegistry,
  })
  await fastify.register(personaRoutes, { registry: ctx.agentRegistry })
  await fastify.register(systemRoutes)
  await fastify.register(sessionRoutes)

  await fastify.register(noteRoutes, { memory: ctx.unifiedMemory })
  await fastify.register(uploadRoutes, { knowledgeStore: ctx.knowledgeStore, router: ctx.modelRouter })

  await fastify.register(streamRoutes, {
    gate: ctx.gate, db: ctx.db, sessionsDb: ctx.sessionsDb, router: ctx.modelRouter, memory: ctx.unifiedMemory,
    agentRegistry: ctx.agentRegistry, toolRegistry: ctx.chatToolRegistry, log: ctx.actionLog, personaMgr: ctx.personaMgr,
  })

  const asyncRunner = new AsyncPipelineRunner(
    ctx.agentRegistry, ctx.modelRouter, ctx.pipelineToolRegistry, ctx.gate, ctx.actionLog, ctx.personaMgr, ctx.steerQueue, ctx.pipelineStore,
  )
  await fastify.register(pipelineRoutes, {
    registry: ctx.agentRegistry,
    router: ctx.modelRouter,
    toolRegistry: ctx.pipelineToolRegistry,
    gate: ctx.gate,
    log: ctx.actionLog,
    personaMgr: ctx.personaMgr,
    steerQueue: ctx.steerQueue,
    pipelineStore: ctx.pipelineStore,
    runner: asyncRunner,
  })

  await fastify.register(eventRoutes)
  await fastify.register(analyticsRoutes, { db: ctx.db })
  await fastify.register(toolRoutes, { loader: ctx.customToolLoader })
  await fastify.register(channelRoutes, { manager: ctx.channelManager })
  await fastify.register(userRoutes, { store: userStore })
  await fastify.register(cronRoutes, { store: ctx.cronStore, scheduler: ctx.cronScheduler })

  await fastify.register(chatRoutes, {
    mcpStore: ctx.mcpStore, gate: ctx.gate, db: ctx.db, sessionsDb: ctx.sessionsDb, router: ctx.modelRouter, memory: ctx.unifiedMemory,
    agentRegistry: ctx.agentRegistry, toolRegistry: ctx.chatToolRegistry, log: ctx.actionLog, skillGaps: ctx.skillGapsLog,
    personaMgr: ctx.personaMgr, contextStore: ctx.contextStore, userModelStore: ctx.userModelStore,
  })
  await fastify.register(skillRoutes, { store: ctx.skillStore, router: ctx.modelRouter, gaps: ctx.skillGapsLog })
  await fastify.register(skillPackRoutes, { skillStore: ctx.skillStore, agentRegistry: ctx.agentRegistry })
  await fastify.register(mcpRoutes, { store: ctx.mcpStore })
  await fastify.register(searchRoutes, { memory: ctx.unifiedMemory })
  await fastify.register(contextRoutes, { store: ctx.contextStore })
  await fastify.register(userModelRoutes, { store: ctx.userModelStore })
  await fastify.register(knowledgeRoutes, { store: ctx.knowledgeStore, router: ctx.modelRouter })

  fastify.addHook('onReady', async () => {
    ctx.cronScheduler.start()
  })

  fastify.addHook('onClose', async () => {
    await ctx.dispose()
  })

  return fastify
}
