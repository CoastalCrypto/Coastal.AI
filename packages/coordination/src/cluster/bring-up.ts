import {
  buildWorkerFolders, buildCuratorFolders, type PeerDevice,
} from '../replication/syncthing-folders.js'
import type { DesiredFolder } from '../replication/syncthing-config.js'
import { ROLE_SPECS } from './roles.js'
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
