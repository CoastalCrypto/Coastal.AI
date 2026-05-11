// packages/architect/src/learnings/browser-snapshot.ts
//
// Browser-snapshotter interface plus a default HTTP-based implementation.
// The HTTP impl can't execute JavaScript so consoleErrors stays empty,
// but it catches the regressions that matter most:
//   - 4xx/5xx HTTP responses on a route the architect just changed
//   - Body shrinkage (a route that suddenly returns near-empty markup)
//   - Fetch-level errors (server stopped, port closed)
//
// A future Playwright/browser-use impl can swap in via the same
// BrowserSnapshotter interface. The notes layer + gate downstream are
// agnostic to who took the snapshot.

import type { DomSnapshot } from '@coastal-ai/core/memory/dom-snapshots'

export interface BrowserSnapshotter {
  snapshot(url: string): Promise<DomSnapshot>
}

export interface HttpSnapshotterConfig {
  /** Per-fetch timeout in ms. Defaults to 10s. */
  timeoutMs?: number
  /** Optional User-Agent override. */
  userAgent?: string
  /** Inject a fetch implementation for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Inject a clock for tests. Defaults to Date.now. */
  now?: () => number
}

const BODY_PREVIEW_CHARS = 1500

/**
 * Default HTTP snapshotter. No JS execution; for routes that render
 * server-side or for raw-HTTP health checks (the dev server is up, the
 * /api/* routes return 200, etc.).
 */
export function createHttpSnapshotter(config: HttpSnapshotterConfig = {}): BrowserSnapshotter {
  const timeoutMs = config.timeoutMs ?? 10_000
  const userAgent = config.userAgent ?? 'CoastalAI-Architect-Snapshotter/1.0'
  const fetchFn = config.fetchFn ?? globalThis.fetch
  const now = config.now ?? Date.now

  return {
    async snapshot(url: string): Promise<DomSnapshot> {
      const start = now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchFn(url, {
          signal: controller.signal,
          headers: { 'user-agent': userAgent },
        })
        const body = await res.text()
        const ok = res.status >= 200 && res.status < 400
        return {
          url, status: res.status, bodyLength: body.length,
          bodyPreview: body.slice(0, BODY_PREVIEW_CHARS),
          consoleErrors: [], // HTTP-only; no JS execution
          takenAt: now(), durationMs: now() - start, ok,
          fetchError: null,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          url, status: 0, bodyLength: 0, bodyPreview: '',
          consoleErrors: [], takenAt: now(), durationMs: now() - start, ok: false,
          fetchError: message,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * Snapshot a list of URLs in sequence. Sequential by design — concurrent
 * fetches against a single dev server can mask flakiness that the gate
 * is supposed to catch.
 */
export async function snapshotAll(
  snapshotter: BrowserSnapshotter,
  urls: readonly string[],
): Promise<DomSnapshot[]> {
  const results: DomSnapshot[] = []
  for (const u of urls) {
    results.push(await snapshotter.snapshot(u))
  }
  return results
}
