// packages/coordination/src/transport/__tests__/localhost.test.ts

import { describe, it, expect } from 'vitest'
import { generateIdentity } from '../../identity/keypair.js'
import { signMessage } from '../a2a-envelope.js'
import { LocalhostBus, createLocalhostTransport } from '../localhost.js'
import type { A2AMessage } from '../../types.js'

function flush(): Promise<void> {
  return new Promise(r => queueMicrotask(r))
}

describe('LocalhostBus + createLocalhostTransport', () => {
  it('delivers a signed message from one agent to another', async () => {
    const bus = new LocalhostBus()
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const tA = createLocalhostTransport({ bus, identity: a })
    const tB = createLocalhostTransport({ bus, identity: b })

    const received: A2AMessage[] = []
    tB.subscribe(msg => received.push(msg))

    await tA.send(signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: { role: 'coder' } },
      a,
    ))
    await flush()

    expect(received).toHaveLength(1)
    expect(received[0].kind).toBe('agent.hello')
    expect(received[0].from.agentId).toBe('agent-A')

    await tA.close()
    await tB.close()
  })

  it('does not deliver to non-addressees', async () => {
    const bus = new LocalhostBus()
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const c = generateIdentity('agent-C')
    const tA = createLocalhostTransport({ bus, identity: a })
    const tB = createLocalhostTransport({ bus, identity: b })
    const tC = createLocalhostTransport({ bus, identity: c })

    const receivedB: A2AMessage[] = []
    const receivedC: A2AMessage[] = []
    tB.subscribe(m => receivedB.push(m))
    tC.subscribe(m => receivedC.push(m))

    await tA.send(signMessage(
      { to: 'agent-B', kind: 'task.claim', payload: { taskId: 't-1' } },
      a,
    ))
    await flush()

    expect(receivedB).toHaveLength(1)
    expect(receivedC).toHaveLength(0)
  })

  it('delivers broadcasts to everyone except the sender', async () => {
    const bus = new LocalhostBus()
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const c = generateIdentity('agent-C')
    const tA = createLocalhostTransport({ bus, identity: a })
    const tB = createLocalhostTransport({ bus, identity: b })
    const tC = createLocalhostTransport({ bus, identity: c })

    const receivedA: A2AMessage[] = []
    const receivedB: A2AMessage[] = []
    const receivedC: A2AMessage[] = []
    tA.subscribe(m => receivedA.push(m))
    tB.subscribe(m => receivedB.push(m))
    tC.subscribe(m => receivedC.push(m))

    await tA.send(signMessage(
      { to: '*', kind: 'agent.hello', payload: null },
      a,
    ))
    await flush()

    expect(receivedA).toHaveLength(0) // no echo to sender
    expect(receivedB).toHaveLength(1)
    expect(receivedC).toHaveLength(1)
  })

  it('echo flag enables sender to see own broadcasts', async () => {
    const bus = new LocalhostBus()
    const a = generateIdentity('agent-A')
    const tA = createLocalhostTransport({ bus, identity: a, echo: true })

    const received: A2AMessage[] = []
    tA.subscribe(m => received.push(m))

    await tA.send(signMessage(
      { to: '*', kind: 'agent.hello', payload: null },
      a,
    ))
    await flush()

    expect(received).toHaveLength(1)
  })

  it('drops messages with bad signatures silently', async () => {
    const bus = new LocalhostBus()
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const tA = createLocalhostTransport({ bus, identity: a })
    const tB = createLocalhostTransport({ bus, identity: b })

    const received: A2AMessage[] = []
    tB.subscribe(m => received.push(m))

    const signed = signMessage({ to: 'agent-B', kind: 'task.claim', payload: { taskId: 't-1' } }, a)
    const tampered = { ...signed, payload: { taskId: 'EVIL' } }

    await tA.send(tampered)
    await flush()

    expect(received).toHaveLength(0)
  })

  it('TOFU peer-key registry blocks pubkey-swap impersonation', async () => {
    const bus = new LocalhostBus()
    const realA = generateIdentity('agent-A')
    const imposter = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')

    // agent-B knows the REAL agent-A pubkey from a prior contact
    const peerKeys = new Map([['agent-A', realA.publicKey]])
    const tImposter = createLocalhostTransport({ bus, identity: imposter })
    const tB = createLocalhostTransport({ bus, identity: b, peerKeys })

    const received: A2AMessage[] = []
    tB.subscribe(m => received.push(m))

    // Imposter signs with their OWN key (valid signature, wrong pubkey)
    await tImposter.send(signMessage(
      { to: 'agent-B', kind: 'task.cancel', payload: { taskId: 't-1' } },
      imposter,
    ))
    await flush()

    expect(received).toHaveLength(0)
  })

  it('unsubscribe stops delivery to that handler', async () => {
    const bus = new LocalhostBus()
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const tA = createLocalhostTransport({ bus, identity: a })
    const tB = createLocalhostTransport({ bus, identity: b })

    const received: A2AMessage[] = []
    const off = tB.subscribe(m => received.push(m))
    off()

    await tA.send(signMessage({ to: 'agent-B', kind: 'agent.hello', payload: null }, a))
    await flush()
    expect(received).toHaveLength(0)
  })
})
