import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { CoreTool } from '../core/file.js'
import { runInSandbox } from './process-sandbox.js'

const TOOL_TIMEOUT_MS = 5000

export interface CustomToolRecord {
  id: string
  name: string
  description: string
  parameters: string   // JSON schema string
  implBody: string     // JS function body
  enabled: number
  createdAt: number
  updatedAt: number
}

export class CustomToolLoader {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS custom_tools (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        parameters  TEXT NOT NULL,
        impl_body   TEXT NOT NULL,
        enabled     INTEGER DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )
    `)
  }

  /** Load all enabled custom tools as CoreTool instances */
  loadAll(): CoreTool[] {
    const rows = this.db
      .prepare('SELECT * FROM custom_tools WHERE enabled = 1')
      .all() as Array<{
        id: string; name: string; description: string;
        parameters: string; impl_body: string;
        created_at: number; updated_at: number
      }>

    return rows.flatMap(row => {
      try {
        return [this.buildTool(row)]
      } catch {
        return []
      }
    })
  }

  private buildTool(row: { id: string; name: string; description: string; parameters: string; impl_body: string }): CoreTool {
    let params: Record<string, unknown>
    try {
      params = JSON.parse(row.parameters)
    } catch {
      params = { type: 'object', properties: {}, required: [] }
    }

    return {
      definition: {
        name: row.name,
        description: row.description,
        parameters: params as any,
        reversible: false,
      },
      execute: async (args: Record<string, unknown>): Promise<string> => {
        // Runs in a separate OS process with Node's permission model denying
        // filesystem/child_process/worker/addon access — see
        // process-sandbox.ts and sandbox-worker.ts for exactly what boundary
        // this provides (and, as honestly stated there, what it doesn't).
        return runInSandbox(row.impl_body, args, TOOL_TIMEOUT_MS)
      },
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────

  list(): CustomToolRecord[] {
    return (this.db.prepare('SELECT * FROM custom_tools ORDER BY created_at DESC').all() as any[])
      .map(this.toRecord)
  }

  get(id: string): CustomToolRecord | undefined {
    const row = this.db.prepare('SELECT * FROM custom_tools WHERE id = ?').get(id) as any
    return row ? this.toRecord(row) : undefined
  }

  create(data: { name: string; description: string; parameters: string; implBody: string }): CustomToolRecord {
    const now = Date.now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO custom_tools (id, name, description, parameters, impl_body, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, data.name, data.description, data.parameters, data.implBody, now, now)
    return this.get(id)!
  }

  update(id: string, data: Partial<{ name: string; description: string; parameters: string; implBody: string; enabled: boolean }>): CustomToolRecord | undefined {
    const fields: string[] = []
    const values: unknown[] = []
    if (data.name        !== undefined) { fields.push('name = ?');        values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.parameters  !== undefined) { fields.push('parameters = ?');  values.push(data.parameters) }
    if (data.implBody    !== undefined) { fields.push('impl_body = ?');   values.push(data.implBody) }
    if (data.enabled     !== undefined) { fields.push('enabled = ?');     values.push(data.enabled ? 1 : 0) }
    if (!fields.length) return this.get(id)
    fields.push('updated_at = ?')
    values.push(Date.now(), id)
    this.db.prepare(`UPDATE custom_tools SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM custom_tools WHERE id = ?').run(id)
  }

  private toRecord(r: any): CustomToolRecord {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      parameters: r.parameters,
      implBody: r.impl_body,
      enabled: r.enabled,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }
}
