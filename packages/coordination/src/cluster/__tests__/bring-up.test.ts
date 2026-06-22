import { describe, it, expect } from 'vitest'
import { bringNodeOnline, type BringUpDeps } from '../bring-up.js'
import { openCoordinationDb } from '../../store/db.js'
import { createPeerRegistry } from '../../identity/peer-registry.js'
import type { NodeConfig, Roster } from '../config.js'
import type { A2ATransport } from '../../transport/types.js'

const paths = { dataDir: '/d', identity: '/d/id.json', sharedVault: '/d/vault', inbox: '/d/inbox', inboxBase: '/d/inboxes' }
const roster: Roster = {
  schema: 'coastal-roster/v1', generatedAt: 1,
  nodes: [
    { nodeId: 'c1', role: 'curator', pubkey: 'PKc', deviceId: 'DEVc', address: 'a' },
    { nodeId: 'w1', role: 'coder',   pubkey: 'PK1', deviceId: 'DEV1', address: 'a' },
    { nodeId: 'm1', role: 'monitor', pubkey: 'PKm', deviceId: 'DEVm', address: 'a' },
  ],
}
const cfg = (role: string, nodeId: string): NodeConfig => ({
  schema: 'coastal-node-config/v1', nodeId, role: role as NodeConfig['role'],
  curatorNodeId: 'c1', paths: { ...paths, identity: `${process.env.TEMP ?? '/tmp'}/${nodeId}-id.json` }, address: 'a',
} as NodeConfig)

function makeDeps(over: Partial<BringUpDeps> = {}): { deps: BringUpDeps; scheduled: { ms: number }[]; reconciled: { path: string; body: unknown }[] } {
  const scheduled: { ms: number }[] = []
  const reconciled: { path: string; body: unknown }[] = []
  const transport: A2ATransport = { send: async () => {}, subscribe: () => () => {}, close: async () => {} }
  const deps: BringUpDeps = {
    db: openCoordinationDb(),
    registry: createPeerRegistry(),
    syncthingHttp: async (_m, path, body) => { reconciled.push({ path, body }); return {} },
    openobserve: { ingest: async () => ({ ingested: 0 }), query: async () => [] },
    noteStore: {} as BringUpDeps['noteStore'],
    makeTransport: () => transport,
    workerFor: () => async () => 'ok',
    notify: () => {},
    schedule: (_fn, ms) => { scheduled.push({ ms }); return { stop: () => {} } },
    ...over,
  }
  return { deps, scheduled, reconciled }
}

describe('bringNodeOnline', () => {
  it('seeds the registry with every other peer (key + device id)', async () => {
    const { deps } = makeDeps()
    const handle = await bringNodeOnline(cfg('coder', 'w1'), roster, deps)
    expect(deps.registry.list().sort()).toEqual(['c1', 'm1'])
    expect(deps.registry.getDeviceId('c1')).toBe('DEVc')
    await handle.stop()
  })

  it('worker schedules worker-tick + heartbeat (2 timers), not a monitor loop', async () => {
    const { deps, scheduled } = makeDeps()
    const handle = await bringNodeOnline(cfg('coder', 'w1'), roster, deps)
    expect(scheduled).toHaveLength(2)
    await handle.stop()
  })

  it('monitor schedules heartbeat + monitor loop but no replication tick', async () => {
    const { deps, scheduled } = makeDeps()
    const handle = await bringNodeOnline(cfg('monitor', 'm1'), roster, deps)
    expect(scheduled).toHaveLength(2)
    await handle.stop()
  })

  it('curator reconciles a sendonly shared-vault folder', async () => {
    const { deps, reconciled } = makeDeps()
    const handle = await bringNodeOnline(cfg('curator', 'c1'), roster, deps)
    const folderPuts = reconciled
      .filter(c => c.path.includes('/folders/shared-vault')) as { path: string; body: { type?: string } }[]
    expect(folderPuts[0]?.body.type).toBe('sendonly')
    await handle.stop()
  })

  it('throws if the node is not in the roster', async () => {
    const { deps } = makeDeps()
    await expect(bringNodeOnline(cfg('coder', 'ghost'), roster, deps)).rejects.toThrow(/not in roster/)
  })

  it('stop() tears down every scheduled timer', async () => {
    const stops: number[] = []
    const { deps } = makeDeps({ schedule: (_fn, _ms) => { const i = stops.length; return { stop: () => stops.push(i) } } })
    const handle = await bringNodeOnline(cfg('coder', 'w1'), roster, deps)
    await handle.stop()
    expect(stops.length).toBe(2)
  })
})
