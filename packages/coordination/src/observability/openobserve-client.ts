export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface OpenObserveConfig {
  baseUrl: string
  org: string
  /** Basic-auth header value, e.g. "Basic base64(user:pass)". */
  auth: string
  fetchImpl: FetchLike
}

export interface OpenObserveClient {
  ingest(stream: string, events: Record<string, unknown>[]): Promise<{ ingested: number }>
  query(sql: string): Promise<Record<string, unknown>[]>
}

/**
 * Minimal typed openobserve client over an injected fetch (so it is unit-testable
 * without a live instance). Ingest uses the bulk `_json` endpoint; query uses
 * `_search` with a SQL body. Non-ok responses throw (validate at the boundary).
 */
export function createOpenObserveClient(cfg: OpenObserveConfig): OpenObserveClient {
  const headers = { 'Content-Type': 'application/json', Authorization: cfg.auth }
  const base = `${cfg.baseUrl}/api/${cfg.org}`
  return {
    async ingest(stream, events) {
      const res = await cfg.fetchImpl(`${base}/${stream}/_json`, { method: 'POST', headers, body: JSON.stringify(events) })
      if (!res.ok) throw new Error(`openobserve ingest ${stream} failed: HTTP ${res.status}`)
      return { ingested: events.length }
    },
    async query(sql) {
      const body = JSON.stringify({ query: { sql, start_time: 0, end_time: Date.now() * 1000 } })
      const res = await cfg.fetchImpl(`${base}/_search`, { method: 'POST', headers, body })
      if (!res.ok) throw new Error(`openobserve query failed: HTTP ${res.status}`)
      const json = (await res.json()) as { hits?: Record<string, unknown>[] }
      return json.hits ?? []
    },
  }
}
