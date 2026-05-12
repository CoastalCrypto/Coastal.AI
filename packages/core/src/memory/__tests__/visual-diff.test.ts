import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteStore } from '../notes.js'
import {
  extractSignature, computeVisualDiff, writeVisualDiffAsNote,
  visualDiffNoteId, visualDiffSourceId,
} from '../visual-diff.js'
import type { DomSnapshot } from '../dom-snapshots.js'

let tempDir: string
let store: NoteStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'visual-diff-'))
  store = new NoteStore({ dataDir: tempDir })
})

afterEach(() => {
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function snap(url: string, body: string, takenAt: number): DomSnapshot {
  return {
    url, status: 200, bodyLength: body.length, bodyPreview: body,
    consoleErrors: [], takenAt, durationMs: 1, ok: true, fetchError: null,
  }
}

describe('extractSignature', () => {
  it('pulls H1-H3 headings, button text, link text, and labels', () => {
    const sig = extractSignature(`
      <h1>Welcome</h1>
      <h2>Subheading</h2>
      <button>Save</button>
      <a href="/x">Click me</a>
      <label>Email</label>
    `)
    expect(sig.headings.sort()).toEqual(['Subheading', 'Welcome'])
    expect(sig.buttons).toEqual(['Save'])
    expect(sig.links).toEqual(['Click me'])
    expect(sig.labels).toEqual(['Email'])
  })

  it('strips inline tags inside extracted text', () => {
    const sig = extractSignature('<button><span class="icon">★</span> Star this</button>')
    expect(sig.buttons).toEqual(['★ Star this'])
  })

  it('detects error keywords', () => {
    expect(extractSignature('Internal Server Error 500').hasErrorKeywords).toBe(true)
    expect(extractSignature('<h1>Hello</h1>').hasErrorKeywords).toBe(false)
  })

  it('returns empty arrays when no recognizable structure exists', () => {
    const sig = extractSignature('plain text with no html')
    expect(sig.headings).toEqual([])
    expect(sig.buttons).toEqual([])
  })
})

describe('computeVisualDiff', () => {
  it('reports identical signatures as similarity=1, regressed=false', () => {
    const a = snap('http://x', '<h1>Hi</h1><button>Go</button>', 1)
    const b = snap('http://x', '<h1>Hi</h1><button>Go</button>', 2)
    const diff = computeVisualDiff(a, b)
    expect(diff.similarity).toBe(1)
    expect(diff.regressed).toBe(false)
  })

  it('flags removed headings as a regression', () => {
    const baseline = snap('http://x', '<h1>Original</h1>', 1)
    const fresh    = snap('http://x', '<h1>Different</h1>', 2)
    const diff = computeVisualDiff(baseline, fresh)
    expect(diff.removed.headings).toEqual(['Original'])
    expect(diff.added.headings).toEqual(['Different'])
    expect(diff.regressed).toBe(true)
  })

  it('flags removed buttons as a regression even if headings stable', () => {
    const baseline = snap('http://x', '<h1>X</h1><button>Save</button>', 1)
    const fresh    = snap('http://x', '<h1>X</h1>', 2)
    const diff = computeVisualDiff(baseline, fresh)
    expect(diff.removed.buttons).toEqual(['Save'])
    expect(diff.regressed).toBe(true)
  })

  it('flags new error keywords as a regression', () => {
    const baseline = snap('http://x', '<h1>Welcome</h1>', 1)
    const fresh    = snap('http://x', '<h1>Welcome</h1><div>500 Internal Server Error</div>', 2)
    const diff = computeVisualDiff(baseline, fresh)
    expect(diff.newErrorKeywords).toBe(true)
    expect(diff.regressed).toBe(true)
  })

  it("treats added items as non-regressing when headings/buttons are intact", () => {
    const baseline = snap('http://x', '<h1>X</h1><button>Save</button>', 1)
    const fresh    = snap('http://x', '<h1>X</h1><button>Save</button><a href="/y">New link</a>', 2)
    const diff = computeVisualDiff(baseline, fresh)
    expect(diff.added.links).toEqual(['New link'])
    expect(diff.regressed).toBe(false)
  })

  it('flags low similarity as a regression even if no specific section was removed', () => {
    // Lots of replaced labels — similarity drops below 0.6
    const baseline = snap('http://x', `
      <h1>X</h1>
      <label>A</label><label>B</label><label>C</label><label>D</label><label>E</label>
    `, 1)
    const fresh = snap('http://x', `
      <h1>X</h1>
      <label>P</label><label>Q</label><label>R</label><label>S</label><label>T</label>
    `, 2)
    const diff = computeVisualDiff(baseline, fresh)
    expect(diff.similarity).toBeLessThan(0.6)
    expect(diff.regressed).toBe(true)
  })

  it('records baseline + fresh timestamps verbatim', () => {
    const a = snap('http://x', '<h1>A</h1>', 100)
    const b = snap('http://x', '<h1>A</h1>', 200)
    const diff = computeVisualDiff(a, b)
    expect(diff.baselineTakenAt).toBe(100)
    expect(diff.freshTakenAt).toBe(200)
  })
})

describe('writeVisualDiffAsNote', () => {
  it('persists with kind=visual_diff and the canonical id format', () => {
    const a = snap('http://x', '<h1>A</h1>', 100)
    const b = snap('http://x', '<h1>A</h1>', 200)
    const diff = computeVisualDiff(a, b)
    const ref = writeVisualDiffAsNote(store, diff)
    expect(ref.noteId).toBe(visualDiffNoteId(diff))
    const note = store.get(ref.noteId)!
    expect(note.kind).toBe('visual_diff')
    expect(note.sourceType).toBe('dom-diff')
    expect(note.sourceId).toBe(visualDiffSourceId('http://x'))
    expect(note.title.startsWith('✓')).toBe(true)
  })

  it('marks regressed diffs with ✗ in the title', () => {
    const a = snap('http://x', '<h1>Original</h1>', 1)
    const b = snap('http://x', '<h1>Changed</h1>', 2)
    const diff = computeVisualDiff(a, b)
    const note = store.get(writeVisualDiffAsNote(store, diff).noteId)!
    expect(note.title.startsWith('✗')).toBe(true)
  })

  it('embeds machine-readable diff-meta block', () => {
    const a = snap('http://x', '<h1>A</h1><button>Save</button>', 1)
    const b = snap('http://x', '<h1>A</h1>', 2)
    const diff = computeVisualDiff(a, b)
    const note = store.get(writeVisualDiffAsNote(store, diff).noteId)!
    expect(note.body).toContain('```diff-meta')
    expect(note.body).toContain('"regressed":true')
  })

  it('renders human-readable add/remove sections when changes occur', () => {
    const a = snap('http://x', '<h1>A</h1><button>Save</button>', 1)
    const b = snap('http://x', '<h1>A</h1><button>Submit</button>', 2)
    const diff = computeVisualDiff(a, b)
    const note = store.get(writeVisualDiffAsNote(store, diff).noteId)!
    expect(note.body).toContain('## Buttons')
    expect(note.body).toContain('+ Submit')
    expect(note.body).toContain('- Save')
  })
})
