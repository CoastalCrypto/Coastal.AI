import { randomUUID } from 'node:crypto'

/**
 * Short-lived, single-use tickets for authenticating browser EventSource
 * connections. The native EventSource API cannot set custom headers, so a
 * gated SSE route (isNetworkRoute in server.ts) can't be reached with the
 * normal x-admin-session header the way a fetch() call can. Instead, the
 * client mints a ticket via an ordinary (header-authenticated) POST just
 * before opening the stream, then passes it as a `?ticket=` query param.
 *
 * Tickets expire quickly and are consumed on first use, so the exposure
 * from appearing in a URL (server access logs, browser history) is far
 * smaller than putting the long-lived session token there.
 */

const TICKET_TTL_MS = 30_000

const tickets = new Map<string, number>() // ticket -> expiresAt

function pruneExpired(now: number): void {
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt <= now) tickets.delete(ticket)
  }
}

export function issueTicket(): string {
  const now = Date.now()
  pruneExpired(now)
  const ticket = randomUUID()
  tickets.set(ticket, now + TICKET_TTL_MS)
  return ticket
}

export function consumeTicket(ticket: string): boolean {
  if (!ticket) return false
  const expiresAt = tickets.get(ticket)
  tickets.delete(ticket) // single-use, whether or not it was valid
  return expiresAt !== undefined && expiresAt > Date.now()
}
