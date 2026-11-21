// packages/core/src/app-context.ts
//
// Single composition root for every shared service buildServer() wires into
// routes. Before this existed, server.ts built several of these twice —
// most seriously ModelRouter, UnifiedMemory, PersonaManager, ActionLog,
// SkillGapsLog and ContextStore each had a "chat" copy and a "pipeline"
// copy, every one of them either opening its own second SQLite handle onto
// the exact same file (PersonaManager → persona.db, SkillGapsLog →
// skill-gaps.db, ModelRouter's CascadeRouter → its tiny-router cache) or
// wrapping the same `db` handle in two independent JS objects. Two caches
// over one database is a split-brain waiting to happen: a mutation through
// one instance is invisible to the other until the next read from disk.
// teamRoutes (api/routes/team.ts) built a *third* ModelRouter and a
// *second* AgentRegistry of its own on top of that.
//
// This builds one instance of everything and one dispose() that closes it
// all in a safe order. Route registration itself stays in server.ts, since
// that's Fastify-specific — this module only owns "what exists", not "what
// it's wired to".

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { loadConfig, type Config } from './config.js'
import { getOrCreateAdminToken } from './api/routes/admin.js'
import { getOrCreateCallbackKey } from './architect/callback-key.js'
import { openArchitectDb } from './architect/db.js'
import { WorkItemStore } from './architect/store.js'
import { CycleStore } from './architect/cycle-store.js'
import { UserProfileStore } from './architect/user-profile/store.js'
import { UserStore } from './users/store.js'
import { AgentRegistry } from './agents/registry.js'
import { PermissionGate } from './agents/permission-gate.js'
import { ActionLog } from './agents/action-log.js'
import { SkillGapsLog } from './agents/skill-gaps.js'
import { EdgeFeedbackStore } from './agents/edge-feedback.js'
import { CustomToolLoader } from './tools/custom/loader.js'
import { ChannelManager } from './channels/manager.js'
import { ToolRegistry } from './tools/registry.js'
import { createBackend } from './tools/backends/index.js'
import { BrowserSessionManager } from './tools/browser/session-manager.js'
import { ModelRouter } from './models/router.js'
import { PersonaManager } from './persona/manager.js'
import { UserModelStore } from './persona/user-model.js'
import { ContextStore } from './context/store.js'
import { UnifiedMemory } from './memory/index.js'
import { KnowledgeStore } from './knowledge/store.js'
import { PipelineStore } from './pipeline/store.js'
import { SteerQueue } from './pipeline/steer-queue.js'
import { CronStore } from './cron/store.js'
import { CronScheduler } from './cron/scheduler.js'
import { SkillStore } from './skills/store.js'
import { McpStore } from './tools/mcp/store.js'
import { resolveLocalBin } from './tools/mcp/resolve-local-bin.js'

export interface AppContext {
  config: Config
  adminToken: string
  callbackKey: Buffer

  db: Database.Database
  sessionsDb: Database.Database
  architectDb: Database.Database

  userStore: UserStore
  agentRegistry: AgentRegistry
  gate: PermissionGate
  actionLog: ActionLog
  skillGapsLog: SkillGapsLog
  edgeFeedbackStore: EdgeFeedbackStore
  customToolLoader: CustomToolLoader
  channelManager: ChannelManager

  architectStore: WorkItemStore
  cycleStore: CycleStore
  userProfileStore: UserProfileStore

  modelRouter: ModelRouter
  personaMgr: PersonaManager
  userModelStore: UserModelStore
  contextStore: ContextStore
  unifiedMemory: UnifiedMemory
  knowledgeStore: KnowledgeStore

  pipelineStore: PipelineStore
  steerQueue: SteerQueue

  /**
   * Chat and pipeline each get their own ToolRegistry/backend, deliberately
   * — not a dedup miss. chatToolRegistry carries browser tools (navigate,
   * click, screenshot) whenever the trust level allows them; pipelineTool
   * Registry never has, in any version of this code before this refactor.
   * Whether that asymmetry is intentional product behavior or a feature
   * that pipelines were simply never given is a product question, not a
   * refactor one — preserved exactly as-is rather than guessed at.
   */
  chatToolRegistry: ToolRegistry
  pipelineToolRegistry: ToolRegistry
  chatBrowserManager?: BrowserSessionManager

  cronStore: CronStore
  cronScheduler: CronScheduler
  skillStore: SkillStore
  mcpStore: McpStore

  /** Closes every owned resource, in dependency order. Safe to call once. */
  dispose(): Promise<void>
}

export async function createAppContext(): Promise<AppContext> {
  const config = loadConfig()
  mkdirSync(config.dataDir, { recursive: true })
  mkdirSync(config.agentWorkdir, { recursive: true })

  const adminToken = getOrCreateAdminToken(config.dataDir)
  const callbackKey = getOrCreateCallbackKey(config.dataDir)

  const db = new Database(join(config.dataDir, 'coastal-ai.db'))
  const userStore = new UserStore(db, adminToken)
  // Ensure the default admin account is fully seeded before accepting
  // requests — without this, a login attempt during scrypt hashing would
  // return "Invalid credentials".
  await userStore.ready

  const sessionsDb = new Database(join(config.dataDir, 'sessions.db'))
  sessionsDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // Architect work-item store (Plan 1 backbone): standalone SQLite database
  // dedicated to coastal-architect's planning surface. Lives next to the
  // main coastal-ai.db so it can be backed up / wiped independently.
  const architectDb = openArchitectDb(join(config.dataDir, 'architect.db'))
  const architectStore = new WorkItemStore(architectDb)
  const cycleStore = new CycleStore(architectDb)
  const userProfileStore = new UserProfileStore(architectDb)

  const agentRegistry = new AgentRegistry(join(config.dataDir, 'agents.db'))
  const gate = new PermissionGate(db)
  const actionLog = new ActionLog(db)
  const skillGapsLog = new SkillGapsLog(config.dataDir)
  const edgeFeedbackStore = new EdgeFeedbackStore(db)
  const customToolLoader = new CustomToolLoader(db)
  const channelManager = new ChannelManager(db)

  const modelRouter = new ModelRouter({
    ollamaUrl: config.ollamaUrl, vllmUrl: config.vllmUrl, airllmUrl: config.airllmUrl, defaultModel: config.defaultModel,
  })
  const personaMgr = new PersonaManager(join(config.dataDir, 'persona.db'))
  const userModelStore = new UserModelStore(db)
  const contextStore = new ContextStore(db)
  const unifiedMemory = new UnifiedMemory({
    dataDir: config.dataDir, mem0ApiKey: config.mem0ApiKey, cloudConsentGranted: config.cloudConsentGranted,
  })
  const knowledgeStore = new KnowledgeStore(db, contextStore, unifiedMemory)

  // Built early so agent-events can read saved-pipeline handoff structure
  // for the initial graph snapshot; pipeline routes reuse the same store.
  const pipelineStore = new PipelineStore(db)
  const steerQueue = new SteerQueue()

  // One shared backend for both registries — chatToolRegistry/pipelineToolRegistry
  // differ only in browser-tool wiring (see the comment on those fields above),
  // not in trustLevel/workdir, so a second createBackend() call would just
  // re-run NamespaceBackend.isAvailable()'s blocking unshare(1) probe for an
  // identical result.
  const sharedBackend = await createBackend(
    config.agentTrustLevel,
    [config.agentWorkdir],
    config.agentTrustLevel === 'remote'
      ? { host: config.sshHost!, port: config.sshPort, username: config.sshUser!, privateKeyPath: config.sshKeyPath! }
      : undefined,
  )
  const chatBrowserManager = config.agentTrustLevel !== 'sandboxed' ? new BrowserSessionManager() : undefined
  const chatToolRegistry = new ToolRegistry({
    backend: sharedBackend,
    browserManager: chatBrowserManager,
    trustLevel: config.agentTrustLevel,
    workdir: config.agentWorkdir,
  })
  const pipelineToolRegistry = new ToolRegistry({
    backend: sharedBackend,
    trustLevel: config.agentTrustLevel,
    workdir: config.agentWorkdir,
  })

  const cronStore = new CronStore(db)
  const internalHost = (config.host === '0.0.0.0' || config.host === '::') ? '127.0.0.1' : config.host
  const cronScheduler = new CronScheduler(cronStore, async (agentId, task) => {
    // /api/chat requires an operator session on every bind address (see
    // api/auth-policy.ts) — the scheduler is an in-process caller with no
    // session of its own, so it authenticates with the raw admin token the
    // onRequest hook treats as a full bypass.
    const res = await fetch(`http://${internalHost}:${config.port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ message: task, sessionId: `cron_${agentId}_${Date.now()}` }),
    })
    const data = await res.json() as { reply?: string }
    return data.reply ?? JSON.stringify(data)
  })

  const skillStore = new SkillStore(db)
  skillStore.seedDefaults()

  const mcpStore = new McpStore(db)
  // Seed default MCP servers if empty. Launched via `node <resolved bin>`
  // rather than `npx <package>@<version>` — both packages are real
  // dependencies of @coastal-ai/core, so this never reaches the npm
  // registry at runtime, on this or any later boot.
  if (mcpStore.list().length === 0) {
    mcpStore.upsert({
      id: 'logic',
      name: 'Thinking',
      command: process.execPath,
      args: [resolveLocalBin('@modelcontextprotocol/server-sequential-thinking')],
      enabled: true,
    })
    mcpStore.upsert({
      id: 'memory',
      name: 'Local Knowledge Graph',
      command: process.execPath,
      args: [resolveLocalBin('@modelcontextprotocol/server-memory')],
      enabled: true,
    })
  }
  // Seed MemPalace if not already registered (idempotent — preserves the
  // user's enabled/disabled choice).
  const palaceDir = join(config.dataDir, 'palace')
  if (!mcpStore.list().find(s => s.id === 'mempalace')) {
    // CC_MEMPALACE_MCP is written by install.sh when mempalace lives in a
    // venv rather than system PATH (PEP 668 distros). Falls back to the
    // entry-point name.
    const mempalaceMcp = process.env.CC_MEMPALACE_MCP
      ?? (process.platform === 'win32' ? 'mempalace-mcp.exe' : 'mempalace-mcp')
    mcpStore.upsert({
      id: 'mempalace',
      name: 'MemPalace Memory',
      command: mempalaceMcp,
      args: ['--palace', palaceDir],
      env: { MEMPALACE_PALACE_PATH: palaceDir },
      enabled: true,
    })
  }

  async function dispose(): Promise<void> {
    cronScheduler.stop()
    agentRegistry.close()
    personaMgr.close()
    modelRouter.close()
    skillGapsLog.close()
    await sharedBackend.dispose?.()
    await chatBrowserManager?.closeAll()
    await unifiedMemory.close()
    architectDb.close()
    sessionsDb.close()
    db.close()
  }

  return {
    config, adminToken, callbackKey,
    db, sessionsDb, architectDb,
    userStore, agentRegistry, gate, actionLog, skillGapsLog, edgeFeedbackStore, customToolLoader, channelManager,
    architectStore, cycleStore, userProfileStore,
    modelRouter, personaMgr, userModelStore, contextStore, unifiedMemory, knowledgeStore,
    pipelineStore, steerQueue,
    chatToolRegistry, pipelineToolRegistry, chatBrowserManager,
    cronStore, cronScheduler, skillStore, mcpStore,
    dispose,
  }
}
