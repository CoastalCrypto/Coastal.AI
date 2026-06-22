import { describe, it, expect } from 'vitest'
import { buildPublicTuple } from '../identity-public.js'
import type { NodeConfig } from '../config.js'

const cfg = {
  schema: 'coastal-node-config/v1', nodeId: 'n1', role: 'coder', curatorNodeId: 'c1',
  paths: { dataDir: '/d', identity: '/d/id.json', sharedVault: '/d/vault', inbox: '/d/inbox', inboxBase: '/d/inboxes' },
  address: '10.0.0.1:4747',
} as NodeConfig

describe('buildPublicTuple', () => {
  it('composes nodeId/role/address from config + pubkey + deviceId', () => {
    const tuple = buildPublicTuple(cfg, { agentId: 'n1', publicKey: 'PK', privateKey: 'SK' }, 'DEVID')
    expect(tuple).toEqual({ nodeId: 'n1', role: 'coder', pubkey: 'PK', deviceId: 'DEVID', address: '10.0.0.1:4747' })
  })
})
