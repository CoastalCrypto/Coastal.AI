import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../../memory/notes.js'
import { isRegisteredKind } from '../../memory/kinds-registry.js'
import { writeAgentNote } from '../team-notes.js'

describe('team-notes', () => {
  it('registers the agent_note kind on import', () => {
    expect(isRegisteredKind('agent_note')).toBe(true)
  })

  it('writes a note attributed to the agent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coastal-team-notes-'))
    const store = new NoteStore({ dataDir: dir })
    writeAgentNote(store, 'cto', 'Chief Technology Officer', 'we should use postgres')

    const [note] = store.list({ kind: 'agent_note' })
    expect(note.kind).toBe('agent_note')
    expect(note.sourceType).toBe('agent')
    expect(note.sourceId).toBe('cto')
    expect(note.body).toBe('we should use postgres')

    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('swallows a NoteStore failure instead of throwing', () => {
    const failingStore = { create: vi.fn(() => { throw new Error('disk full') }) }
    expect(() => writeAgentNote(failingStore as any, 'cto', 'CTO', 'x')).not.toThrow()
  })
})
