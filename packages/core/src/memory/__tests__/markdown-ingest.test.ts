import { describe, it, expect } from 'vitest'
import { ingestMarkdown, markdownNoteId } from '../markdown-ingest.js'

const SAMPLE = `# Web Design System

Top-level intro paragraph. Should not appear in any section body.

## Color Tokens

Primary: cyan #00e5ff
Surface: deep blue #0d1f33

## Typography

Sans: Space Grotesk
Mono: JetBrains Mono

## Components

See [[Color Tokens]] for the palette every component reads from.
`

describe('ingestMarkdown', () => {
  it('produces a file-note plus one section per H2', () => {
    const r = ingestMarkdown({ relPath: 'packages/web/DESIGN.md', source: SAMPLE })
    expect(r.notes).toHaveLength(4) // 1 file + 3 sections
    expect(r.notes[0].title).toBe('Web Design System')
    expect(r.notes[0].level).toBe(1)
    expect(r.notes.slice(1).map(n => n.title)).toEqual(['Color Tokens', 'Typography', 'Components'])
  })

  it('uses stable anchor-based ids for sections', () => {
    const r = ingestMarkdown({ relPath: 'packages/web/DESIGN.md', source: SAMPLE })
    const colors = r.notes.find(n => n.title === 'Color Tokens')!
    expect(colors.id).toBe('design:packages/web/DESIGN.md#color-tokens')
    const file = r.notes[0]
    expect(file.id).toBe('design:packages/web/DESIGN.md')
  })

  it('puts content into the section body, not the file body', () => {
    const r = ingestMarkdown({ relPath: 'x.md', source: SAMPLE })
    const colors = r.notes.find(n => n.title === 'Color Tokens')!
    expect(colors.body).toContain('cyan #00e5ff')
    expect(r.notes[0].body).not.toContain('cyan #00e5ff')
  })

  it("emits 'contains' links from file note to each section", () => {
    const r = ingestMarkdown({ relPath: 'x.md', source: SAMPLE })
    const fileId = r.notes[0].id
    const containsLinks = r.links.filter(l => l.kind === 'contains' && l.fromId === fileId)
    expect(containsLinks).toHaveLength(3)
  })

  it("resolves in-file [[wikilink]] mentions to sibling section ids", () => {
    const r = ingestMarkdown({ relPath: 'x.md', source: SAMPLE })
    const components = r.notes.find(n => n.title === 'Components')!
    const colorsId = r.notes.find(n => n.title === 'Color Tokens')!.id
    const mention = r.links.find(l => l.kind === 'mentions' && l.fromId === components.id && l.toId === colorsId)
    expect(mention).toBeDefined()
  })

  it('does not produce a self-mention when a section wikilinks itself', () => {
    const src = `# T\n\n## Self\n\nsee [[Self]] inside\n`
    const r = ingestMarkdown({ relPath: 'x.md', source: src })
    expect(r.links.filter(l => l.kind === 'mentions')).toHaveLength(0)
  })

  it('falls back to filename as title when there is no H1', () => {
    const r = ingestMarkdown({ relPath: 'foo/bar/CONVENTIONS.md', source: '## A\n' })
    expect(r.notes[0].title).toBe('CONVENTIONS')
  })

  it('handles markdown with no sections (only file note emitted)', () => {
    const r = ingestMarkdown({ relPath: 'x.md', source: '# Title\n\nnothing.\n' })
    expect(r.notes).toHaveLength(1)
    expect(r.links).toHaveLength(0)
  })

  it('respects custom note kind', () => {
    const r = ingestMarkdown({ relPath: 'x.md', source: '## A\nbody', kind: 'learning' })
    expect(r.notes.every(n => n.kind === 'learning')).toBe(true)
    expect(r.notes[0].id.startsWith('learning:')).toBe(true)
  })
})

describe('markdownNoteId', () => {
  it('builds path-only id with no anchor', () => {
    expect(markdownNoteId('a/b.md', null)).toBe('design:a/b.md')
  })

  it('appends an anchor with #', () => {
    expect(markdownNoteId('a/b.md', 'colors')).toBe('design:a/b.md#colors')
  })

  it('honors a custom kind', () => {
    expect(markdownNoteId('x.md', 'a', 'learning')).toBe('learning:x.md#a')
  })
})
