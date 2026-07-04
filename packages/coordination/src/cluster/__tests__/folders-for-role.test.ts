import { describe, it, expect } from 'vitest'
import { foldersForRole } from '../bring-up.js'
import type { NodeConfig, Roster } from '../config.js'

const paths = { dataDir: '/d', identity: '/d/id.json', sharedVault: '/d/vault', inbox: '/d/inbox', inboxBase: '/d/inboxes' }
const cfg = (role: string, nodeId: string): NodeConfig => ({
  schema: 'coastal-node-config/v1', nodeId, role: role as NodeConfig['role'], curatorNodeId: 'c1', paths, address: 'a',
} as NodeConfig)
const roster: Roster = {
  schema: 'coastal-roster/v1', generatedAt: 1,
  nodes: [
    { nodeId: 'c1', role: 'curator', pubkey: 'PKc', deviceId: 'DEVc', address: 'a' },
    { nodeId: 'w1', role: 'coder',   pubkey: 'PK1', deviceId: 'DEV1', address: 'a' },
    { nodeId: 'w2', role: 'writer',  pubkey: 'PK2', deviceId: 'DEV2', address: 'a' },
    { nodeId: 'm1', role: 'monitor', pubkey: 'PKm', deviceId: 'DEVm', address: 'a' },
  ],
}

describe('foldersForRole', () => {
  it('worker gets a receiveonly vault + its own sendonly inbox', () => {
    const folders = foldersForRole(cfg('coder', 'w1'), roster)
    expect(folders.find(f => f.id === 'shared-vault')?.type).toBe('receiveonly')
    expect(folders.find(f => f.id === 'inbox-w1')?.type).toBe('sendonly')
  })
  it('curator gets a sendonly vault + one receiveonly inbox per worker (not the monitor)', () => {
    const folders = foldersForRole(cfg('curator', 'c1'), roster)
    expect(folders.find(f => f.id === 'shared-vault')?.type).toBe('sendonly')
    expect(folders.filter(f => f.id.startsWith('inbox-')).map(f => f.id).sort()).toEqual(['inbox-w1', 'inbox-w2'])
  })
  it('observer (monitor) gets no folders', () => {
    expect(foldersForRole(cfg('monitor', 'm1'), roster)).toEqual([])
  })
})
