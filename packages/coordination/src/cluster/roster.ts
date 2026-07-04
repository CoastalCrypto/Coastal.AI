import { RosterEntry, Roster, type Roster as RosterT } from './config.js'

export function assembleRoster(tuples: unknown[], now: number): RosterT {
  const entries = tuples.map(t => RosterEntry.parse(t))
  return Roster.parse({
    schema: 'coastal-roster/v1',
    generatedAt: now,
    nodes: [...entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  })
}
