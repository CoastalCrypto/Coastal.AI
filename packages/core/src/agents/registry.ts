import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentConfig, AgentBinding, AgentFileConfig, AgentHandConfig } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const BUILT_IN_AGENTS: Omit<AgentConfig, 'createdAt'>[] = [
  {
    id: 'coo',
    name: 'Chief Operating Officer',
    role: 'Operations, workflows, team coordination, OKRs',
    soulPath: '',  // resolved at runtime
    tools: ['read_file', 'list_dir', 'http_get', 'query_db'],
    builtIn: true,
    active: true,
  },
  {
    id: 'cfo',
    name: 'Chief Financial Officer',
    role: 'Finance, budgets, forecasting, financial reporting',
    soulPath: '',
    tools: ['read_file', 'list_dir', 'query_db', 'http_get', 'analyze_dataset'],
    builtIn: true,
    active: true,
  },
  {
    id: 'cto',
    name: 'Chief Technology Officer',
    role: 'Engineering, architecture, infrastructure, security',
    soulPath: '',
    tools: ['read_file', 'write_file', 'list_dir', 'delete_file', 'run_command', 'git_status', 'git_diff', 'git_commit', 'git_log', 'query_db', 'http_get'],
    builtIn: true,
    active: true,
  },
  {
    id: 'general',
    name: 'General Assistant',
    role: 'General-purpose assistant for all topics',
    soulPath: '',
    tools: ['read_file', 'list_dir', 'http_get'],
    builtIn: true,
    active: true,
  },
  {
    id: 'product_manager',
    name: 'Product Manager',
    role: 'Product discovery, scoping, prioritization, roadmap',
    soulPath: '',
    tools: ['read_file', 'list_dir', 'http_get'],
    builtIn: true,
    active: true,
  },
  {
    id: 'frontend_wizard',
    name: 'Frontend Wizard',
    role: 'UI/UX development, accessibility, web performance',
    soulPath: '',
    tools: ['read_file', 'write_file', 'list_dir', 'delete_file', 'git_status', 'git_diff'],
    builtIn: true,
    active: true,
  },
  {
    id: 'ux_architect',
    name: 'UX Architect',
    role: 'User journey mapping, friction auditing, information architecture',
    soulPath: '',
    tools: ['read_file', 'list_dir', 'http_get'],
    builtIn: true,
    active: true,
  },
  {
    id: 'qa_lead',
    name: 'QA Lead',
    role: 'Integration testing, edge case discovery, verification',
    soulPath: '',
    tools: ['read_file', 'run_command', 'http_get'],
    builtIn: true,
    active: true,
  },
  {
    id: 'system_integrator',
    name: 'System Integrator',
    role: 'CLI-Anything execution, GUI software control, local machine orchestration',
    soulPath: '',
    tools: ['read_file', 'run_command', 'list_dir'],
    builtIn: true,
    active: true,
  },
]

export type CreateAgentInput = {
  name: string
  role: string
  soulPath: string
  tools: string[]
  modelPref?: string
  voice?: string
}

export class AgentRegistry {
  private db: Database.Database
  private builtInSoulsDir: string
  // get()/list()/listAll() resolve these per row, and are on the hot path
  // (every chat message, every pipeline stage, every team-chain hop) — but
  // the files they probe for (agents/<id>/config.json, agents/<id>/SYSTEM.md)
  // are operator-installed overrides that don't change while the process is
  // running, so the existsSync/readFileSync result is cached per agentId
  // instead of re-probed on every call.
  private fileConfigCache = new Map<string, AgentFileConfig | null>()
  private soulOverrideCache = new Map<string, string | null>()

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.builtInSoulsDir = join(__dirname, 'souls')
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        role       TEXT NOT NULL,
        soul_path  TEXT NOT NULL,
        tools      TEXT NOT NULL,
        model_pref TEXT,
        voice      TEXT,
        built_in   INTEGER DEFAULT 0,
        active     INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `)
    // Migrations
    try { this.db.exec('ALTER TABLE agents ADD COLUMN voice TEXT') } catch {}
    try { this.db.exec("ALTER TABLE agents ADD COLUMN bindings TEXT DEFAULT '[]'") } catch {}

    // Per-agent credential store
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_credentials (
        agent_id   TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, key)
      )
    `)

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO agents (id, name, role, soul_path, tools, built_in, active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?)
    `)
    const now = Date.now()
    for (const agent of BUILT_IN_AGENTS) {
      const soulPath = join(this.builtInSoulsDir, `SOUL_${agent.id.toUpperCase()}.md`)
      insert.run(agent.id, agent.name, agent.role, soulPath, JSON.stringify(agent.tools), now)
    }
  }

  list(): AgentConfig[] {
    const rows = this.db.prepare('SELECT * FROM agents WHERE active = 1 ORDER BY built_in DESC, created_at ASC').all() as any[]
    return rows.map(row => this.rowToConfig(row))
  }

  listAll(): AgentConfig[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY built_in DESC, created_at ASC').all() as any[]
    return rows.map(row => this.rowToConfig(row))
  }

  get(id: string): AgentConfig | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any
    return row ? this.rowToConfig(row) : null
  }

  /** Batched get() — one query instead of one per id. Order is not guaranteed to match `ids`. */
  getMany(ids: string[]): AgentConfig[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT * FROM agents WHERE id IN (${placeholders})`).all(...ids) as any[]
    return rows.map(row => this.rowToConfig(row))
  }

  getByDomain(domain: string): AgentConfig | null {
    return this.get(domain) ?? this.get('general')
  }

  create(input: CreateAgentInput): string {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO agents (id, name, role, soul_path, tools, model_pref, voice, built_in, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(id, input.name, input.role, input.soulPath, JSON.stringify(input.tools), input.modelPref ?? null, input.voice ?? null, Date.now())
    return id
  }

  update(id: string, fields: Partial<Pick<AgentConfig, 'name' | 'role' | 'soulPath' | 'tools' | 'modelPref' | 'voice' | 'active' | 'bindings'>>): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name) }
    if (fields.role !== undefined) { sets.push('role = ?'); values.push(fields.role) }
    if (fields.soulPath !== undefined) { sets.push('soul_path = ?'); values.push(fields.soulPath) }
    if (fields.tools !== undefined) { sets.push('tools = ?'); values.push(JSON.stringify(fields.tools)) }
    if (fields.modelPref !== undefined) { sets.push('model_pref = ?'); values.push(fields.modelPref) }
    if (fields.voice !== undefined) { sets.push('voice = ?'); values.push(fields.voice || null) }
    if (fields.active !== undefined) { sets.push('active = ?'); values.push(fields.active ? 1 : 0) }
    if (fields.bindings !== undefined) { sets.push('bindings = ?'); values.push(JSON.stringify(fields.bindings)) }
    if (sets.length === 0) return
    values.push(id)
    const result = this.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    if (result.changes === 0) throw new Error(`Agent not found: ${id}`)
  }

  delete(id: string): void {
    const row = this.db.prepare('SELECT built_in FROM agents WHERE id = ?').get(id) as any
    if (!row) throw new Error(`Agent not found: ${id}`)
    if (row.built_in) throw new Error('Cannot delete built-in agent')
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  }

  /** Get all credentials for an agent as a key/value map. */
  getCredentials(agentId: string): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM agent_credentials WHERE agent_id = ?').all(agentId) as Array<{ key: string; value: string }>
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  }

  /** Set a single credential. Upserts. */
  setCredential(agentId: string, key: string, value: string): void {
    if (!this.get(agentId)) throw new Error(`Agent not found: ${agentId}`)
    this.db.prepare(
      'INSERT OR REPLACE INTO agent_credentials (agent_id, key, value, updated_at) VALUES (?, ?, ?, ?)'
    ).run(agentId, key, value, Date.now())
  }

  /** Delete a single credential. Throws if not found. */
  deleteCredential(agentId: string, key: string): void {
    const result = this.db.prepare('DELETE FROM agent_credentials WHERE agent_id = ? AND key = ?').run(agentId, key)
    if (result.changes === 0) throw new Error(`Credential not found: ${agentId}/${key}`)
  }

  /**
   * Find the highest-priority agent whose binding rules match the given sessionId or source header.
   * Returns null if no binding matches (fall through to domain routing).
   */
  findBindingMatch(sessionId: string, source: string | null): AgentConfig | null {
    const candidates = this.list().filter(a => a.bindings && a.bindings.length > 0)
    const pairs = candidates
      .flatMap(a => (a.bindings ?? []).map(b => ({ agent: a, binding: b })))
      .sort((a, b) => b.binding.priority - a.binding.priority)
    for (const { agent, binding } of pairs) {
      if (binding.sessionPattern) {
        try { if (new RegExp(binding.sessionPattern).test(sessionId)) return agent } catch {}
      }
      if (binding.source && source !== null && binding.source === source) return agent
    }
    return null
  }

  close(): void { this.db.close() }

  private loadFileConfig(agentId: string): AgentFileConfig | null {
    const cached = this.fileConfigCache.get(agentId)
    if (cached !== undefined) return cached

    const candidates = [
      join(process.cwd(), 'agents', agentId, 'config.json'),
      join(__dirname, '..', '..', '..', '..', 'agents', agentId, 'config.json'),
    ]
    let result: AgentFileConfig | null = null
    for (const p of candidates) {
      if (existsSync(p)) {
        try { result = JSON.parse(readFileSync(p, 'utf8')) as AgentFileConfig; break } catch {}
      }
    }
    this.fileConfigCache.set(agentId, result)
    return result
  }

  private resolvedSoulPath(agentId: string, dbSoulPath: string): string {
    return this.findSoulOverride(agentId) ?? dbSoulPath
  }

  /** Resolved separately from the db path so db-stored soulPath changes (update()) are never masked by a stale cache entry. */
  private findSoulOverride(agentId: string): string | null {
    const cached = this.soulOverrideCache.get(agentId)
    if (cached !== undefined) return cached

    const candidates = [
      join(process.cwd(), 'agents', agentId, 'SYSTEM.md'),
      join(__dirname, '..', '..', '..', '..', 'agents', agentId, 'SYSTEM.md'),
    ]
    let found: string | null = null
    for (const p of candidates) {
      if (existsSync(p)) { found = p; break }
    }
    this.soulOverrideCache.set(agentId, found)
    return found
  }

  private rowToConfig(row: any): AgentConfig {
    const fileConfig = this.loadFileConfig(row.id)
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      soulPath: this.resolvedSoulPath(row.id, row.soul_path),
      tools: fileConfig?.tools ?? this.parseTools(row.id, row.tools),
      modelPref: fileConfig?.modelPref ?? row.model_pref ?? undefined,
      voice: row.voice ?? undefined,
      builtIn: Boolean(row.built_in),
      active: Boolean(row.active),
      createdAt: row.created_at,
      hand: fileConfig?.hand,
      bindings: this.parseBindings(row.bindings),
    }
  }

  private parseBindings(raw: string | null): AgentBinding[] {
    if (!raw) return []
    try { return JSON.parse(raw) as AgentBinding[] } catch { return [] }
  }

  private parseTools(agentId: string, raw: string): string[] {
    try {
      return JSON.parse(raw) as string[]
    } catch {
      console.error(`[AgentRegistry] Failed to parse tools for agent ${agentId}, defaulting to []`)
      return []
    }
  }
}
