import { registerKind } from '../memory/kinds-registry.js'
import type { NoteStore } from '../memory/notes.js'

// Module-load-time registration, same convention as every other kind-registering
// package (see kinds-registry.ts's own doc comment).
registerKind('agent_note')

/**
 * Write an agent's turn into the shared store so any later, unrelated task can
 * recall it via recallContextMessage. Fail-open and silent on error — a
 * memory-write failure must never fail the user-facing reply (unlike
 * verifyCommitment, which fails open toward *visibility* — these are
 * different failure classes on purpose).
 */
export function writeAgentNote(noteStore: NoteStore, agentId: string, agentName: string, body: string): void {
  try {
    noteStore.create({
      title: `${agentName} — team note`,
      body,
      kind: 'agent_note',
      sourceType: 'agent',
      sourceId: agentId,
    })
  } catch (err) {
    console.error(`[team-notes] failed to write note for agent ${agentId}:`, err)
  }
}
