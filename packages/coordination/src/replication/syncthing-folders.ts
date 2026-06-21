import type { DesiredFolder } from './syncthing-config.js'

/** A peer node and its Syncthing device id. */
export interface PeerDevice { nodeId: string; deviceId: string }

/**
 * Hub-and-spoke folder topology (see the replication design spec).
 *
 * Folder IDs are shared between the two devices that mount them, so a worker's
 * `inbox-<nodeId>` is the same Syncthing folder the Curator mounts at
 * `<inboxBase>/<nodeId>`. The Curator is the sole writer of `shared-vault`
 * (send-only) and a read-only sink for each worker inbox.
 */

/** Folders for a WORKER node: a read-only vault replica + its own send-only inbox. */
export function buildWorkerFolders(
  self: PeerDevice,
  curator: PeerDevice,
  paths: { sharedVault: string; inbox: string },
): DesiredFolder[] {
  return [
    { id: 'shared-vault', path: paths.sharedVault, type: 'receiveonly', deviceIds: [curator.deviceId] },
    { id: `inbox-${self.nodeId}`, path: paths.inbox, type: 'sendonly', deviceIds: [curator.deviceId] },
  ]
}

/** Folders for the CURATOR node: the authoritative vault + one inbox sink per worker. */
export function buildCuratorFolders(
  workers: PeerDevice[],
  paths: { sharedVault: string; inboxBase: string },
): DesiredFolder[] {
  const folders: DesiredFolder[] = [
    { id: 'shared-vault', path: paths.sharedVault, type: 'sendonly', deviceIds: workers.map(w => w.deviceId) },
  ]
  for (const w of workers) {
    folders.push({
      id: `inbox-${w.nodeId}`,
      path: `${paths.inboxBase}/${w.nodeId}`,
      type: 'receiveonly',
      deviceIds: [w.deviceId],
    })
  }
  return folders
}
