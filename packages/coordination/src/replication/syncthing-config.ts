export type SyncthingHttp = (method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<unknown>

export interface DesiredFolder {
  id: string
  path: string
  type: 'sendonly' | 'receiveonly' | 'sendreceive'
  deviceIds: string[]
}

export interface ReconcileInput {
  peers: { peerId: string; syncthingDeviceId: string }[]
  folders: DesiredFolder[]
  knownDeviceIds: Set<string>
}

/**
 * Push desired devices + folders into Syncthing via its REST config API.
 * Membership is allowlist-only: every device referenced must be in
 * knownDeviceIds (the Ed25519-verified peer set) or we refuse.
 */
export async function reconcileSyncthing(http: SyncthingHttp, input: ReconcileInput): Promise<void> {
  for (const f of input.folders) {
    for (const d of f.deviceIds) {
      if (!input.knownDeviceIds.has(d)) {
        throw new Error(`refusing folder ${f.id}: references unknown device ${d}`)
      }
    }
  }
  for (const p of input.peers) {
    if (!input.knownDeviceIds.has(p.syncthingDeviceId)) continue
    await http('PUT', `/rest/config/devices/${p.syncthingDeviceId}`, {
      deviceID: p.syncthingDeviceId, name: p.peerId, autoAcceptFolders: false,
    })
  }
  for (const f of input.folders) {
    await http('PUT', `/rest/config/folders/${f.id}`, {
      id: f.id, path: f.path, type: f.type,
      devices: f.deviceIds.map(deviceID => ({ deviceID })),
    })
  }
}
