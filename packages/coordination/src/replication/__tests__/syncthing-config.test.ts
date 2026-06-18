import { describe, it, expect } from 'vitest'
import { reconcileSyncthing, type SyncthingHttp, type DesiredFolder } from '../syncthing-config.js'

const peers = [
  { peerId: 'node-2', syncthingDeviceId: 'DEV-2' },
  { peerId: 'node-9', syncthingDeviceId: 'DEV-9' },
]
const folders: DesiredFolder[] = [
  { id: 'shared-vault', path: '/var/lib/coastal/replication/shared-vault', type: 'receiveonly', deviceIds: ['DEV-9'] },
]

describe('reconcileSyncthing', () => {
  it('adds only allowlisted devices and the desired folders', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = []
    const http: SyncthingHttp = async (method, path, body) => { calls.push({ method, path, body }); return {} }
    await reconcileSyncthing(http, { peers, folders, knownDeviceIds: new Set(['DEV-2', 'DEV-9']) })
    expect(calls.some(c => c.method === 'PUT' && c.path.includes('/rest/config/devices/DEV-9'))).toBe(true)
    expect(calls.some(c => c.path.includes('/rest/config/folders/shared-vault'))).toBe(true)
  })

  it('refuses a folder referencing an unknown device', async () => {
    const http: SyncthingHttp = async () => ({})
    await expect(reconcileSyncthing(http, {
      peers, knownDeviceIds: new Set(['DEV-2']),
      folders: [{ ...folders[0], deviceIds: ['DEV-UNKNOWN'] }],
    })).rejects.toThrow(/unknown device/i)
  })
})
