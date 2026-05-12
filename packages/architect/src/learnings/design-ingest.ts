// packages/architect/src/learnings/design-ingest.ts
//
// Finds every `packages/<name>/DESIGN.md` in the repo and runs the
// markdown ingester + sync against the notes store. Called once per
// daemon startup so the planner sees fresh design context on each cycle.

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { NoteStore } from '@coastal-ai/core/memory/notes'
import { ingestMarkdown } from '@coastal-ai/core/memory/markdown-ingest'
import { syncMarkdownIngest, type MarkdownSyncResult } from '@coastal-ai/core/memory/markdown-sync'

export interface DesignIngestSummary {
  files: number
  added: number
  updated: number
  removed: number
  edgesAdded: number
  edgesRemoved: number
  paths: string[]
}

/**
 * Discover and ingest every `packages/<name>/DESIGN.md` under `rootDir`.
 * Returns the aggregate sync result; empty when no design docs exist.
 */
export function ingestDesignDocs(store: NoteStore, rootDir: string): DesignIngestSummary {
  const summary: DesignIngestSummary = {
    files: 0, added: 0, updated: 0, removed: 0, edgesAdded: 0, edgesRemoved: 0, paths: [],
  }
  const packagesDir = join(rootDir, 'packages')
  let pkgs: string[]
  try {
    pkgs = readdirSync(packagesDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
  } catch {
    return summary
  }

  for (const pkg of pkgs) {
    const designPath = join(packagesDir, pkg, 'DESIGN.md')
    let source: string
    try {
      const s = statSync(designPath)
      if (!s.isFile()) continue
      source = readFileSync(designPath, 'utf8')
    } catch { continue }

    const relPath = relative(rootDir, designPath).split(sep).join('/')
    const result: MarkdownSyncResult = syncMarkdownIngest(
      store,
      ingestMarkdown({ relPath, source }),
    )
    summary.files++
    summary.paths.push(relPath)
    summary.added += result.added
    summary.updated += result.updated
    summary.removed += result.removed
    summary.edgesAdded += result.edgesAdded
    summary.edgesRemoved += result.edgesRemoved
  }

  return summary
}
