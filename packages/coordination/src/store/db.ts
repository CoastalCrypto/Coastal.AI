// packages/coordination/src/store/db.ts
//
// Database connection helper. Mirrors NoteStore's pattern of self-contained
// `{ dataDir }` config — coordination owns its own SQLite file
// (`coordination.db`) under the same data directory as obsidian.db /
// architect.db / lossless.db.

import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * In Phase 1 we use the file path; tests use ':memory:'. The schema
 * is identical either way.
 */
export interface CoordinationDbConfig {
  dataDir?: string
  /** Override for tests; defaults to `<dataDir>/coordination.db`. */
  dbPath?: string
}

export function openCoordinationDb(config: CoordinationDbConfig = {}): Database.Database {
  const dbPath = config.dbPath
    ?? (config.dataDir ? join(config.dataDir, 'coordination.db') : ':memory:')

  if (config.dataDir && dbPath !== ':memory:') {
    mkdirSync(config.dataDir, { recursive: true })
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schemaPath = join(__dirname, 'schema.sql')
  const schema = readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  return db
}
