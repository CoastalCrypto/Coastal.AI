import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface Skill {
  id: string
  name: string          // slug used as /name command
  description: string
  prompt: string        // template — {{variable}} placeholders supported
  agentId: string       // preferred agent to run this with
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export class SkillStore {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        prompt      TEXT NOT NULL,
        agent_id    TEXT NOT NULL DEFAULT 'general',
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )
    `)
  }

  list(): Skill[] {
    return (this.db.prepare('SELECT * FROM skills ORDER BY created_at ASC').all() as any[]).map(this.map)
  }

  get(id: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any
    return row ? this.map(row) : null
  }

  getByName(name: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as any
    return row ? this.map(row) : null
  }

  /** Batched get() — one query instead of one per id. Order is not guaranteed to match `ids`. */
  getMany(ids: string[]): Skill[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT * FROM skills WHERE id IN (${placeholders})`).all(...ids) as any[]
    return rows.map(this.map)
  }

  create(data: Pick<Skill, 'name' | 'description' | 'prompt' | 'agentId'>): Skill {
    const id = randomUUID()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO skills (id, name, description, prompt, agent_id, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, data.name, data.description, data.prompt, data.agentId, now, now)
    return this.get(id)!
  }

  update(id: string, data: Partial<Pick<Skill, 'name' | 'description' | 'prompt' | 'agentId' | 'enabled'>>): Skill | null {
    const sets: string[] = ['updated_at = ?']
    const vals: any[] = [Date.now()]
    if (data.name        !== undefined) { sets.push('name = ?');        vals.push(data.name) }
    if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description) }
    if (data.prompt      !== undefined) { sets.push('prompt = ?');      vals.push(data.prompt) }
    if (data.agentId     !== undefined) { sets.push('agent_id = ?');    vals.push(data.agentId) }
    if (data.enabled     !== undefined) { sets.push('enabled = ?');     vals.push(data.enabled ? 1 : 0) }
    this.db.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    return this.get(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id)
  }

  seedDefaults(): void {
    const { n } = this.db.prepare('SELECT COUNT(*) as n FROM skills').get() as { n: number }
    if (n > 0) return
    const raw = readFileSync(join(__dirname, 'default-skills.json'), 'utf-8')
    const skills = JSON.parse(raw) as Array<Pick<Skill, 'name' | 'description' | 'prompt' | 'agentId'>>
    for (const s of skills) this.create(s)
  }

  private map(row: any): Skill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      prompt: row.prompt,
      agentId: row.agent_id,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
