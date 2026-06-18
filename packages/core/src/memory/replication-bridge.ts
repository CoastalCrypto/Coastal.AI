import type { NoteStore, Note } from './notes.js'
import { exportNotes } from './notes-export.js'
import { ingestDir } from './notes-ingest.js'

export type { Note } from './notes.js'

/** Worker inbox: only locally-authored notes (origin === null) leave the node. */
export const workerSelector = (n: Note): boolean => n.origin === null

export interface WorkerDirs { inbox: string; sharedVault: string }
export interface CuratorDirs { inboxes: string[]; sharedVault: string }

/**
 * One worker tick: push local notes up to the inbox (stamped with this node's
 * id), then pull the shared vault down. `nodeId` is this node's stable id.
 */
export function runWorkerTick(store: NoteStore, dirs: WorkerDirs, nodeId: string): void {
  exportNotes(store, dirs.inbox, workerSelector, nodeId)
  ingestDir(store, dirs.sharedVault)
}

/**
 * One curator tick: ingest each worker inbox, then export the keep set to the
 * shared vault. `keep` is the Curator's grading predicate (default: keep all).
 */
export function runCuratorTick(
  store: NoteStore,
  dirs: CuratorDirs,
  nodeId: string,
  keep: (n: Note) => boolean = () => true,
): void {
  for (const inbox of dirs.inboxes) ingestDir(store, inbox)
  exportNotes(store, dirs.sharedVault, keep, nodeId)
}
