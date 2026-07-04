import type Database from 'better-sqlite3'
import {
  buildWorkerFolders, buildCuratorFolders, type PeerDevice,
} from '../replication/syncthing-folders.js'
import {
  reconcileSyncthing, type DesiredFolder, type SyncthingHttp,
} from '../replication/syncthing-config.js'
import { loadOrCreateIdentity } from '../identity/keypair.js'
import { TaskStore } from '../store/task-store.js'
import { ClaimStore } from '../store/claim-store.js'
import { runCoordinationDaemon, type CoordinationDaemon, type DaemonConfig } from '../daemon.js'
import type { A2ATransport } from '../transport/types.js'
import type { AgentIdentity } from '../types.js'
import type { PeerRegistry } from '../identity/peer-registry.js'
import type { OpenObserveClient } from '../observability/openobserve-client.js'
import type { Alert } from '../observability/health-eval.js'
import { emitHeartbeat } from '../observability/heartbeat.js'
import { runMonitorOnce } from '../observability/monitor-loop.js'
import { runWorkerTick, runCuratorTick, type Note } from '@coastal-ai/core/memory/replication-bridge'
import type { NoteStore } from '@coastal-ai/core/memory/notes'
import { ROLE_SPECS, shouldClaimFor } from './roles.js'
import type { NodeConfig, Roster, RosterEntry } from './config.js'

const dev = (n: RosterEntry): PeerDevice => ({ nodeId: n.nodeId, deviceId: n.deviceId })

/** Pure derivation of this node's Syncthing folders from its role + the roster. */
export function foldersForRole(cfg: NodeConfig, roster: Roster): DesiredFolder[] {
  const self = roster.nodes.find(n => n.nodeId === cfg.nodeId)
  if (!self) throw new Error(`foldersForRole: ${cfg.nodeId} not in roster`)
  const spec = ROLE_SPECS[cfg.role]
  const workers = roster.nodes.filter(n => ROLE_SPECS[n.role].replicationRole === 'worker')

  if (spec.replicationRole === 'curator') {
    return buildCuratorFolders(workers.map(dev), {
      sharedVault: cfg.paths.sharedVault, inboxBase: cfg.paths.inboxBase,
    })
  }
  if (spec.replicationRole === 'worker') {
    const curator = roster.nodes.find(n => n.nodeId === cfg.curatorNodeId)
    if (!curator || curator.role !== 'curator') {
      throw new Error(`foldersForRole: curatorNodeId '${cfg.curatorNodeId}' does not resolve to a curator`)
    }
    return buildWorkerFolders(dev(self), dev(curator), {
      sharedVault: cfg.paths.sharedVault, inbox: cfg.paths.inbox,
    })
  }
  return [] // observer
}

export const TICK_MS = 15_000
export const HEARTBEAT_MS = 10_000
export const MONITOR_MS = 30_000
export const STALENESS_MS = 30_000

export interface NodeHandle { daemon: CoordinationDaemon; stop(): Promise<void> }

export interface BringUpDeps {
  db: Database.Database
  registry: PeerRegistry
  syncthingHttp: SyncthingHttp
  openobserve: OpenObserveClient
  noteStore: NoteStore
  makeTransport: (id: AgentIdentity, roster: Roster, reg: PeerRegistry) => A2ATransport
  workerFor: (role: NodeConfig['role']) => DaemonConfig['worker']
  keep?: (n: Note) => boolean
  notify: (alerts: Alert[]) => void
  now?: () => number
  schedule?: (fn: () => void, ms: number) => { stop: () => void }
}

function defaultSchedule(fn: () => void, ms: number): { stop: () => void } {
  const timer = setInterval(() => { try { fn() } catch (e) { console.warn(`[tick] ${(e as Error).message}`) } }, ms)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/**
 * The cluster-join composition root. Given a node's config + the shared roster,
 * bring the node fully online: load on-node identity, seed peer trust from the
 * roster (public material), reconcile the Syncthing topology, start the
 * role-appropriate coordination daemon, and schedule replication ticks +
 * heartbeat (+ a monitor loop on the monitor node). Returns a stop handle.
 */
export async function bringNodeOnline(cfg: NodeConfig, roster: Roster, deps: BringUpDeps): Promise<NodeHandle> {
  const now = deps.now ?? Date.now
  const schedule = deps.schedule ?? defaultSchedule

  const self = roster.nodes.find(n => n.nodeId === cfg.nodeId)
  if (!self) throw new Error(`bringNodeOnline: ${cfg.nodeId} not in roster`)

  const identity = loadOrCreateIdentity(cfg.nodeId, cfg.paths.identity)

  // seed trust from the roster (public material)
  const peers = roster.nodes.filter(n => n.nodeId !== cfg.nodeId)
  for (const p of peers) {
    deps.registry.recordOrVerify(p.nodeId, p.pubkey)
    deps.registry.setDeviceId(p.nodeId, p.deviceId)
  }

  // Syncthing topology (foldersForRole validates self + curator resolution)
  const folders = foldersForRole(cfg, roster)
  await reconcileSyncthing(deps.syncthingHttp, {
    peers: peers.map(p => ({ peerId: p.nodeId, syncthingDeviceId: p.deviceId })),
    folders,
    knownDeviceIds: deps.registry.knownDeviceIds(),
  })

  // daemon with role-appropriate worker + claim policy
  const spec = ROLE_SPECS[cfg.role]
  const daemon = runCoordinationDaemon({
    identity,
    transport: deps.makeTransport(identity, roster, deps.registry),
    db: deps.db,
    tasks: new TaskStore(deps.db),
    claims: new ClaimStore(deps.db),
    worker: deps.workerFor(cfg.role),
    shouldClaim: shouldClaimFor(spec),
  })

  // replication ticks (by role) + heartbeat (all) + monitor loop (monitor only)
  const workers = roster.nodes.filter(n => ROLE_SPECS[n.role].replicationRole === 'worker')
  const timers: { stop: () => void }[] = []
  if (spec.replicationRole === 'worker') {
    timers.push(schedule(() => runWorkerTick(
      deps.noteStore, { inbox: cfg.paths.inbox, sharedVault: cfg.paths.sharedVault }, cfg.nodeId), TICK_MS))
  } else if (spec.replicationRole === 'curator') {
    timers.push(schedule(() => runCuratorTick(
      deps.noteStore,
      { inboxes: workers.map(w => `${cfg.paths.inboxBase}/${w.nodeId}`), sharedVault: cfg.paths.sharedVault },
      cfg.nodeId, deps.keep), TICK_MS))
  }
  timers.push(schedule(() => void emitHeartbeat(deps.openobserve, cfg.nodeId, cfg.role, now()), HEARTBEAT_MS))
  if (cfg.role === 'monitor') {
    const expected = roster.nodes.map(n => n.nodeId)
    timers.push(schedule(() => void runMonitorOnce(deps.openobserve, expected, now(), STALENESS_MS, deps.notify), MONITOR_MS))
  }

  return {
    daemon,
    async stop() { for (const t of timers) t.stop(); await daemon.stop() },
  }
}
