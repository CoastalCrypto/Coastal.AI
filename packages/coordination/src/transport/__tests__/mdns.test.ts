// packages/coordination/src/transport/__tests__/mdns.test.ts
//
// mDNS discovery tests. These depend on actual multicast networking
// being permitted on the test host. CI sandboxes that block multicast
// will see the discovery never fire; the tests are gated behind an
// env var so they can be skipped on those environments.
//
// Run locally with: COORDINATION_MDNS_TEST=1 pnpm test
//
// When skipped, we still test the pure-function pieces (hash helper,
// service-name generation) inline.

import { describe, it, expect } from 'vitest'
import { generateIdentity } from '../../identity/keypair.js'
import { publicKeyShortHash, createMdnsDiscovery } from '../mdns.js'

describe('publicKeyShortHash', () => {
  it('returns a 16-char hex string', () => {
    const id = generateIdentity('agent-A')
    const hash = publicKeyShortHash(id.publicKey)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for the same input', () => {
    const id = generateIdentity('agent-A')
    expect(publicKeyShortHash(id.publicKey)).toBe(publicKeyShortHash(id.publicKey))
  })

  it('differs for different keys', () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    expect(publicKeyShortHash(a.publicKey)).not.toBe(publicKeyShortHash(b.publicKey))
  })
})

const liveMdns = process.env.COORDINATION_MDNS_TEST === '1'
const liveDescribe = liveMdns ? describe : describe.skip

liveDescribe('createMdnsDiscovery — live multicast', () => {
  it('two daemons discover each other on the same network', async () => {
    const idA = generateIdentity('mdns-a')
    const idB = generateIdentity('mdns-b')

    // Use a test-only service type so we don't collide with real Coastal.AI
    // instances that might be running on the host.
    const serviceType = `coastal-ai-test-${Math.floor(Math.random() * 1e6)}`

    const dA = createMdnsDiscovery({ identity: idA, port: 4001, role: 'tester', serviceType })
    const dB = createMdnsDiscovery({ identity: idB, port: 4002, role: 'tester', serviceType })

    try {
      const discoveredByA = await new Promise((resolve) => {
        dA.onPeer(peer => {
          if (peer.agentId === 'mdns-b') resolve(peer)
        })
        // Safety timeout — mDNS can take a moment
        setTimeout(() => resolve(null), 5000)
      })

      expect(discoveredByA).not.toBeNull()
      expect((discoveredByA as { agentId: string }).agentId).toBe('mdns-b')
      expect((discoveredByA as { port: number }).port).toBe(4002)
    } finally {
      await dA.stop()
      await dB.stop()
    }
  }, 10000)
})
