import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { healthRoutes } from './api/routes/health.js'
import { wsRoutes } from './api/routes/ws.js'
import { agentEventsRoute } from './api/routes/agent-events.js'
import { graphQLRoutes } from './api/routes/graphql.js'
import { chatRoutes } from './api/routes/chat.js'
import { adminActionsRoutes } from './api/routes/admin-actions.js'
import { adminRoutes, getOrCreateAdminToken, validateSessionToken } from './api/routes/admin.js'
import { architectRoutes } from './api/routes/architect.js'
import { architectCycleRoutes } from './api/routes/architect-cycles.js'
import { architectControlRoutes } from './api/routes/architect-controls.js'
import { architectInsightRoutes } from './api/routes/architect-insights.js'
import { architectReceiptRoutes } from './api/routes/architect-receipts.js'
import { architectCallbackRoutes } from './api/routes/architect-callbacks.js'
import { architectSSERoutes } from './api/routes/architect-events-sse.js'
import { architectUserProfileRoutes } from './api/routes/architect-user-profile.js'
import { openArchitectDb } from './architect/db.js'
import { WorkItemStore } from './architect/store.js'
import { CycleStore } from './architect/cycle-store.js'
import { UserProfileStore } from './architect/user-profile/store.js'
import { agentRoutes } from './api/routes/agents.js'
import { agentMemoryRoutes } from './api/routes/agent-memory.js'
import { teamRoutes } from './api/routes/team.js'
import { personaRoutes } from './api/routes/persona.js'
import { systemRoutes } from './api/routes/system.js'
import { sessionRoutes } from './api/routes/sessions.js'
import { uploadRoutes } from './api/routes/upload.js'
import { streamRoutes } from './api/routes/stream.js'
import { pipelineRoutes } from './api/routes/pipeline.js'
import { ModelRouter } from './models/router.js'
import { ToolRegistry } from './tools/registry.js'
import { ActionLog } from './agents/action-log.js'
import { PersonaManager } from './persona/manager.js'
import { createBackend } from './tools/backends/index.js'
import { mkdirSync } from 'node:fs'
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
import { KnowledgeStore } from './knowledge/store.js'
import { CronStore } from './cron/store.js'
import { CronScheduler } from './cron/scheduler.js'
import { SkillStore } from './skills/store.js'
import { ContextStore } from './context/store.js'
import { UserModelStore } from './persona/user-model.js'
import { SkillGapsLog } from './agents/skill-gaps.js'
import { PipelineStore } from './pipeline/store.js'
import { SteerQueue } from './pipeline/steer-queue.js'
import { AsyncPipelineRunner } from './pipeline/runner.js'
import { UnifiedMemory } from './memory/index.js'
import { UserStore } from './users/store.js'
import { AgentRegistry } from './agents/registry.js'
import { PermissionGate } from './agents/permission-gate.js'
import { CustomToolLoader } from './tools/custom/loader.js'
import { EdgeFeedbackStore } from './agents/edge-feedback.js'
import { ChannelManager } from './channels/manager.js'
import { McpStore } from './tools/mcp/store.js'
import { loadConfig } from './config.js'
import multipart from '@fastify/multipart'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'

export async function buildServer() {
  // maxParamLength raised to 500 to support base64url-encoded callback tokens
  // (default is 100, which is too short for JSON payloads embedded in tokens).
  const fastify = Fastify({ logger: false, maxParamLength: 500 })
  const config = loadConfig()

  // Root-level admin auth — applies to ALL /api/admin/* routes across all plugins
  const adminToken = getOrCreateAdminToken(config.dataDir)
  // UserStore is created here so the auth hook can reference it for user session tokens.
  // It is also passed to userRoutes below.
  const db = new Database(join(config.dataDir, 'coastal-ai.db'))
  const userStore = new UserStore(db, adminToken)

  fastify.addHook('onRequest', async (req, reply) => {
    // CORS preflight must bypass auth so the browser can complete the handshake.
    // The @fastify/cors plugin replies to OPTIONS with the proper Access-Control-* headers.
    if (req.method === 'OPTIONS') return
    const isAdminRoute = req.url.startsWith('/api/admin')
    const isNetworkRoute = req.url.startsWith('/api/chat') || req.url.startsWith('/api/upload')
    // Only enforce auth on admin routes, and on chat/upload when server is network-exposed
    const isNetworkExposed = config.host !== '127.0.0.1' && config.host !== '::1' && config.host !== 'localhost'
    if (!isAdminRoute && !(isNetworkExposed && isNetworkRoute)) return
    if (req.url === '/api/admin/login') return

    // 1. Raw admin token (legacy / CLI usage)
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
      // 2. Legacy admin session token (issued by /api/admin/login)
      if (validateSessionToken(adminToken, session)) return
      // 3. User session token (issued by /api/auth/login) — admin role required
      const claims = userStore.verifySessionToken(session)
      if (claims?.role === 'admin') return
      console.warn(`[auth] 401 ${req.method} ${req.url} — session present but invalid (role=${claims?.role ?? 'null'}, prefix=${session.slice(0, 3)})`)
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
  await fastify.register(wsRoutes)
  await fastify.register(adminRoutes)

  const agentRegistry = new AgentRegistry(join(config.dataDir, 'agents.db'))
  const gate = new PermissionGate(db)
  const customToolLoader = new CustomToolLoader(db)
  const channelManager = new ChannelManager(db)
  const edgeFeedbackStore = new EdgeFeedbackStore(db)
  // Built early so agent-events can read saved-pipeline handoff structure
  // for the initial graph snapshot. Pipeline routes reuse this same store.
  const pipelineStore = new PipelineStore(db)

  await fastify.register(agentEventsRoute, {
    registry: agentRegistry,
    channelManager,
    db,
    feedbackStore: edgeFeedbackStore,
    pipelineStore,
    validateSession: (token: string) => {
      if (validateSessionToken(adminToken, token)) return true
      const claims = userStore.verifySessionToken(token)
      return claims !== null
    }
  })
  // Register GraphQL endpoint for agent dependency analysis
  await fastify.register(graphQLRoutes, { registry: agentRegistry })
  await fastify.register(agentRoutes, { registry: agentRegistry, gate })
  await fastify.register(agentMemoryRoutes, { registry: agentRegistry, db })
  await fastify.register(adminActionsRoutes)

  // Architect work-item store (Plan 1 backbone): standalone SQLite database
  // dedicated to coastal-architect's planning surface. Lives next to the
  // main coastal-ai.db so it can be backed up / wiped independently.
  const architectDb = openArchitectDb(join(config.dataDir, 'architect.db'))
  const architectStore = new WorkItemStore(architectDb)
  const cycleStore = new CycleStore(architectDb)
  const userProfileStore = new UserProfileStore(architectDb)
  await fastify.register(architectRoutes, { store: architectStore })
  await fastify.register(architectCycleRoutes, { cycleStore, workStore: architectStore })
  await fastify.register(architectControlRoutes, { dataDir: config.dataDir })
  await fastify.register(architectUserProfileRoutes, { profileStore: userProfileStore })
  await fastify.register(architectInsightRoutes, { cycleStore, workStore: architectStore })
  await fastify.register(architectReceiptRoutes, { cycleStore })
  await fastify.register(architectCallbackRoutes, {
    cycleStore,
    verifyToken: (token: string) => {
      // Stub decoder for v1.5.0: both the daemon and server share the same host/data dir,
      // so the architect daemon can pass a real signer via a shared mechanism in a future
      // chunk. For now, accept tokens that are valid base64url-encoded JSON with the
      // required shape. Real HMAC verification lives in the architect package (CallbackSigner).
      try {
        const decoded = JSON.parse(Buffer.from(token, 'base64url').toString())
        if (decoded.cycleId && decoded.gate && decoded.decision) return decoded
        return null
      } catch { return null }
    },
  })
  await fastify.register(architectSSERoutes, { db: architectDb })

  await fastify.register(teamRoutes)
  await fastify.register(personaRoutes, { registry: agentRegistry })
  await fastify.register(systemRoutes)
  await fastify.register(sessionRoutes)
  // Shared infrastructure needed by multiple routes. Built here so upload.ts
  // can auto-persist chat uploads into the knowledge library.
  mkdirSync(config.dataDir, { recursive: true })
  mkdirSync(config.agentWorkdir, { recursive: true })
  const pipelineRouter = new ModelRouter({ ollamaUrl: config.ollamaUrl, vllmUrl: config.vllmUrl, airllmUrl: config.airllmUrl, defaultModel: config.defaultModel })
  const sharedContextStore = new ContextStore(db)
  const sharedSearchMemory = new UnifiedMemory({ dataDir: config.dataDir, mem0ApiKey: config.mem0ApiKey, cloudConsentGranted: config.cloudConsentGranted })
  const sharedKnowledgeStore = new KnowledgeStore(db, sharedContextStore, sharedSearchMemory)

  await fastify.register(uploadRoutes, { knowledgeStore: sharedKnowledgeStore, router: pipelineRouter })
  await fastify.register(streamRoutes, { gate })
  const pipelineBackend = await createBackend(config.agentTrustLevel, [config.agentWorkdir])
  const pipelineToolRegistry = new ToolRegistry({
    backend: pipelineBackend,
    trustLevel: config.agentTrustLevel,
    workdir: config.agentWorkdir,
  })
  const pipelineLog = new ActionLog(db)
  const pipelinePersonaMgr = new PersonaManager(join(config.dataDir, 'persona.db'))
  const steerQueue = new SteerQueue()
  const asyncRunner = new AsyncPipelineRunner(
    agentRegistry, pipelineRouter, pipelineToolRegistry, gate, pipelineLog, pipelinePersonaMgr, steerQueue, pipelineStore,
  )
  await fastify.register(pipelineRoutes, {
    registry: agentRegistry,
    router: pipelineRouter,
    toolRegistry: pipelineToolRegistry,
    gate,
    log: pipelineLog,
    personaMgr: pipelinePersonaMgr,
    steerQueue,
    pipelineStore,
    runner: asyncRunner,
  })

  await fastify.register(eventRoutes)
  await fastify.register(analyticsRoutes, { db })
  await fastify.register(toolRoutes, { loader: customToolLoader })
  await fastify.register(channelRoutes, { manager: channelManager })
  await fastify.register(userRoutes, { store: userStore })

  const cronStore = new CronStore(db)
  const internalHost = (config.host === '0.0.0.0' || config.host === '::') ? '127.0.0.1' : config.host
  const cronScheduler = new CronScheduler(cronStore, async (agentId, task) => {
    const res = await fetch(`http://${internalHost}:${config.port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: task, sessionId: `cron_${agentId}_${Date.now()}` }),
    })
    const data = await res.json() as any
    return data.reply ?? JSON.stringify(data)
  })
  await fastify.register(cronRoutes, { store: cronStore, scheduler: cronScheduler })

  const skillStore = new SkillStore(db)
  skillStore.seedDefaults()
  const mcpStore = new McpStore(db)
  // Seed default MCP servers if empty
  if (mcpStore.list().length === 0) {
    mcpStore.upsert({
      id: 'logic',
      name: 'Thinking',
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['@modelcontextprotocol/server-sequential-thinking@2025.12.18'],
      enabled: true
    })
    mcpStore.upsert({
      id: 'memory',
      name: 'Local Knowledge Graph',
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['@modelcontextprotocol/server-memory@2026.1.26'],
      enabled: true
    })
  }
  // Seed MemPalace if not already registered (idempotent — preserves user's enabled/disabled choice)
  const palaceDir = join(config.dataDir, 'palace')
  if (!mcpStore.list().find(s => s.id === 'mempalace')) {
    // CC_MEMPALACE_MCP is written by install.sh when mempalace lives in a venv
    // rather than system PATH (PEP 668 distros). Falls back to the entry-point name.
    const mempalaceMcp = process.env.CC_MEMPALACE_MCP
      ?? (process.platform === 'win32' ? 'mempalace-mcp.exe' : 'mempalace-mcp')
    mcpStore.upsert({
      id: 'mempalace',
      name: 'MemPalace Memory',
      command: mempalaceMcp,
      args: ['--palace', palaceDir],
      env: { MEMPALACE_PALACE_PATH: palaceDir },
      enabled: true
    })
  }

  const skillGaps = new SkillGapsLog(config.dataDir)
  const userModelStore = new UserModelStore(db)

  await fastify.register(chatRoutes, { mcpStore, gate })
  await fastify.register(skillRoutes, { store: skillStore, router: pipelineRouter, gaps: skillGaps })
  await fastify.register(skillPackRoutes, { skillStore, agentRegistry })
  await fastify.register(mcpRoutes, { store: mcpStore })
  await fastify.register(searchRoutes, { memory: sharedSearchMemory })
  await fastify.register(contextRoutes, { store: sharedContextStore })
  await fastify.register(userModelRoutes, { store: userModelStore })

  await fastify.register(knowledgeRoutes, { store: sharedKnowledgeStore, router: pipelineRouter })

  // Ensure the default admin account is fully seeded before accepting requests.
  // Without this, a login attempt during scrypt hashing would return "Invalid credentials".
  await userStore.ready

  fastify.addHook('onReady', async () => {
    cronScheduler.start()
  })

  fastify.addHook('onClose', async () => {
    cronScheduler.stop()
    agentRegistry.close()
    pipelinePersonaMgr.close()
    pipelineRouter.close()
    skillGaps.close()
    await sharedSearchMemory.close()
    architectDb.close()
    db.close()
  })

  return fastify
}
