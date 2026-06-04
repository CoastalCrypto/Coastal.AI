// packages/coordination/src/transport/__tests__/tcp.test.ts
//
// Live-socket tests. Each test spins up two transports on ephemeral
// ports inside the same Node process and validates real network I/O,
// not mocks.

import { describe, it, expect } from 'vitest'
import { generateIdentity } from '../../identity/keypair.js'
import { createPeerRegistry } from '../../identity/peer-registry.js'
import { signMessage } from '../a2a-envelope.js'
import { createTcpTransport, type TcpTransport } from '../tcp.js'
import type { A2AMessage } from '../../types.js'

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('createTcpTransport — live sockets', () => {
  it('delivers a signed message between two transports', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const regA = createPeerRegistry()
    const regB = createPeerRegistry()

    const tA = await createTcpTransport({
      identity: a,
      port: 0,
      bindAddress: '127.0.0.1',
      peerRegistry: regA,
    })
    const tB = await createTcpTransport({
      identity: b,
      port: 0,
      bindAddress: '127.0.0.1',
      peerRegistry: regB,
    })

    try {
      // Wire A → B as outbound; B → A inbound is implicit since they
      // share sockets bidirectionally once connected.
      tA.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })

      const received: A2AMessage[] = []
      tB.subscribe(msg => received.push(msg))

      // Let the connection establish
      await wait(50)
      expect(tA.connectedPeers()).toEqual(['agent-B'])

      await tA.send(signMessage(
        { to: 'agent-B', kind: 'agent.hello', payload: { role: 'tester' } },
        a,
      ))

      await wait(50)
      expect(received).toHaveLength(1)
      expect(received[0].from.agentId).toBe('agent-A')
      expect(received[0].kind).toBe('agent.hello')
    } finally {
      await tA.close()
      await tB.close()
    }
  })

  it('TOFU records the peer on first contact', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const regB = createPeerRegistry()

    const tA = await createTcpTransport({
      identity: a, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tB = await createTcpTransport({
      identity: b, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: regB,
    })

    try {
      tA.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })
      await wait(30)

      await tA.send(signMessage(
        { to: 'agent-B', kind: 'agent.hello', payload: null },
        a,
      ))
      await wait(30)

      expect(regB.get('agent-A')).toBe(a.publicKey)
    } finally {
      await tA.close()
      await tB.close()
    }
  })

  it('rejects messages from an impersonating peer (locked pubkey)', async () => {
    const realA = generateIdentity('agent-A')
    const imposter = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')

    const regB = createPeerRegistry()
    regB.recordOrVerify('agent-A', realA.publicKey) // pre-lock

    const tImposter = await createTcpTransport({
      identity: imposter, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tB = await createTcpTransport({
      identity: b, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: regB,
    })

    try {
      tImposter.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })
      await wait(30)

      const received: A2AMessage[] = []
      tB.subscribe(msg => received.push(msg))

      await tImposter.send(signMessage(
        { to: 'agent-B', kind: 'task.cancel', payload: { taskId: 't-1' } },
        imposter,
      ))
      await wait(30)

      expect(received).toEqual([])
    } finally {
      await tImposter.close()
      await tB.close()
    }
  })

  it('handles broadcast (to=*) to all known peers', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const c = generateIdentity('agent-C')

    const tA = await createTcpTransport({
      identity: a, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tB = await createTcpTransport({
      identity: b, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tC = await createTcpTransport({
      identity: c, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })

    try {
      tA.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })
      tA.addPeer({ agentId: 'agent-C', address: '127.0.0.1', port: tC.getServerPort() })
      await wait(50)

      const rcvB: A2AMessage[] = []
      const rcvC: A2AMessage[] = []
      tB.subscribe(m => rcvB.push(m))
      tC.subscribe(m => rcvC.push(m))

      await tA.send(signMessage(
        { to: '*', kind: 'agent.hello', payload: null },
        a,
      ))
      await wait(50)

      expect(rcvB).toHaveLength(1)
      expect(rcvC).toHaveLength(1)
    } finally {
      await tA.close()
      await tB.close()
      await tC.close()
    }
  })

  it('drops tampered messages', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')

    const tA = await createTcpTransport({
      identity: a, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tB = await createTcpTransport({
      identity: b, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })

    try {
      tA.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })
      await wait(30)

      const received: A2AMessage[] = []
      tB.subscribe(m => received.push(m))

      const signed = signMessage(
        { to: 'agent-B', kind: 'task.claim', payload: { taskId: 'real' } },
        a,
      )
      const tampered = { ...signed, payload: { taskId: 'EVIL' } }
      await tA.send(tampered)
      await wait(30)

      expect(received).toEqual([])
    } finally {
      await tA.close()
      await tB.close()
    }
  })

  it('removePeer drops the connection', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')

    const tA = await createTcpTransport({
      identity: a, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tB = await createTcpTransport({
      identity: b, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })

    try {
      tA.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })
      await wait(30)
      expect(tA.connectedPeers()).toEqual(['agent-B'])
      tA.removePeer('agent-B')
      await wait(30)
      expect(tA.connectedPeers()).toEqual([])
    } finally {
      await tA.close()
      await tB.close()
    }
  })

  it('queues messages sent before the peer connection establishes, then flushes', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')

    const tA = await createTcpTransport({
      identity: a, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    const tB = await createTcpTransport({
      identity: b, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })

    try {
      const received: A2AMessage[] = []
      tB.subscribe(m => received.push(m))

      // Add the peer AND immediately send — connection hasn't completed yet
      tA.addPeer({ agentId: 'agent-B', address: '127.0.0.1', port: tB.getServerPort() })
      await tA.send(signMessage(
        { to: 'agent-B', kind: 'agent.hello', payload: { early: true } },
        a,
      ))

      await wait(80) // give socket + flush time
      expect(received).toHaveLength(1)
    } finally {
      await tA.close()
      await tB.close()
    }
  })

  it('refuses to add self as a peer', async () => {
    const a = generateIdentity('agent-A')
    const tA = await createTcpTransport({
      identity: a, port: 0, bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    try {
      tA.addPeer({ agentId: 'agent-A', address: '127.0.0.1', port: tA.getServerPort() })
      await wait(20)
      expect(tA.connectedPeers()).toEqual([])
    } finally {
      await tA.close()
    }
  })
})
