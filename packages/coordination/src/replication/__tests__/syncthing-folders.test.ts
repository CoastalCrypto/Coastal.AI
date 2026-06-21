import { describe, it, expect } from 'vitest'
import { buildWorkerFolders, buildCuratorFolders } from '../syncthing-folders.js'

const curator = { nodeId: 'node-1', deviceId: 'DEV-1' }
const w2 = { nodeId: 'node-2', deviceId: 'DEV-2' }
const w3 = { nodeId: 'node-3', deviceId: 'DEV-3' }

describe('buildWorkerFolders', () => {
  it('shared-vault receive-only + own inbox send-only, both pointed at the curator', () => {
    const f = buildWorkerFolders(w2, curator, { sharedVault: '/v', inbox: '/in' })
    expect(f).toEqual([
      { id: 'shared-vault', path: '/v', type: 'receiveonly', deviceIds: ['DEV-1'] },
      { id: 'inbox-node-2', path: '/in', type: 'sendonly', deviceIds: ['DEV-1'] },
    ])
  })
})

describe('buildCuratorFolders', () => {
  it('shared-vault send-only to all workers + one receive-only inbox per worker', () => {
    const f = buildCuratorFolders([w2, w3], { sharedVault: '/v', inboxBase: '/inbox' })
    expect(f).toEqual([
      { id: 'shared-vault', path: '/v', type: 'sendonly', deviceIds: ['DEV-2', 'DEV-3'] },
      { id: 'inbox-node-2', path: '/inbox/node-2', type: 'receiveonly', deviceIds: ['DEV-2'] },
      { id: 'inbox-node-3', path: '/inbox/node-3', type: 'receiveonly', deviceIds: ['DEV-3'] },
    ])
  })
})
