import { describe, it, expect } from 'vitest'
import { NodeConfig, Roster } from '../config.js'

const goodNode = {
  schema: 'coastal-node-config/v1', nodeId: 'n1', role: 'coder', curatorNodeId: 'c1',
  paths: { dataDir: '/var/lib/coastal', identity: '/var/lib/coastal/identity.json',
    sharedVault: '/var/lib/coastal/vault', inbox: '/var/lib/coastal/inbox', inboxBase: '/var/lib/coastal/inboxes' },
  address: '10.0.0.1:4747',
}
const entry = (o: Partial<Record<string, unknown>>) => ({
  nodeId: 'n1', role: 'coder', pubkey: 'PK', deviceId: 'DEV', address: '10.0.0.1:4747', ...o,
})

describe('NodeConfig', () => {
  it('accepts a well-formed node config', () => {
    expect(NodeConfig.parse(goodNode).nodeId).toBe('n1')
  })
  it('rejects an unknown schema literal', () => {
    expect(() => NodeConfig.parse({ ...goodNode, schema: 'x' })).toThrow()
  })
})

describe('Roster', () => {
  it('accepts exactly one curator', () => {
    const r = Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'c1', role: 'curator' }), entry({ nodeId: 'n1', role: 'coder' })] })
    expect(r.nodes).toHaveLength(2)
  })
  it('rejects duplicate nodeIds', () => {
    expect(() => Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'c1', role: 'curator' }), entry({ nodeId: 'c1', role: 'coder' })] }))
      .toThrow(/duplicate nodeIds/)
  })
  it('rejects zero or two curators', () => {
    expect(() => Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'a', role: 'coder' })] })).toThrow(/exactly one curator/)
    expect(() => Roster.parse({ schema: 'coastal-roster/v1', generatedAt: 1,
      nodes: [entry({ nodeId: 'a', role: 'curator' }), entry({ nodeId: 'b', role: 'curator' })] }))
      .toThrow(/exactly one curator/)
  })
})
