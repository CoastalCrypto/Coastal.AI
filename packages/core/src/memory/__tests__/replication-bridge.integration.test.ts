import { describe, it, expect } from 'vitest'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import { exportNotes } from '../notes-export.js'
import { ingestDir } from '../notes-ingest.js'

const worker = () => new NoteStore({ dataDir: mkdtempSync(join(tmpdir(), 'w-')) })
const sync = (a: string, b: string) => { rmSync(b, { recursive: true, force: true }); cpSync(a, b, { recursive: true }) }

describe('replication bridge end-to-end', () => {
  it('propagates a note from worker -> curator -> other worker, then deletes', () => {
    const w1 = worker(), curator = worker(), w2 = worker()
    const w1Inbox = mkdtempSync(join(tmpdir(), 'w1inbox-'))
    const curInboxView = mkdtempSync(join(tmpdir(), 'curinbox-'))
    const curVault = mkdtempSync(join(tmpdir(), 'curvault-'))
    const w2Vault = mkdtempSync(join(tmpdir(), 'w2vault-'))

    // w1 authors a note, exports local-origin notes to its inbox
    const n = w1.create({ title: 'finding', body: 'v1', kind: 'learning' })
    exportNotes(w1, w1Inbox, note => note.origin === null, 'node-w1')
    sync(w1Inbox, curInboxView)                 // Syncthing: w1 inbox -> curator

    // curator ingests inbox, "grades" (keep all here), exports keepers to vault
    ingestDir(curator, curInboxView)
    expect(curator.get(n.id)?.body).toBe('v1')
    exportNotes(curator, curVault, () => true, 'node-curator')
    sync(curVault, w2Vault)                      // Syncthing: vault -> w2

    // w2 ingests the shared vault
    ingestDir(w2, w2Vault)
    expect(w2.get(n.id)?.body).toBe('v1')

    // curator prunes the note -> vault file removed -> w2 deletes locally
    curator.delete(n.id)
    exportNotes(curator, curVault, () => true, 'node-curator')
    sync(curVault, w2Vault)
    const r = ingestDir(w2, w2Vault)
    expect(r.deleted).toBe(1)
    expect(w2.get(n.id)).toBeNull()
  })
})
