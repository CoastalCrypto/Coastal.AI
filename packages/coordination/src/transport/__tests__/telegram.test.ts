// packages/coordination/src/transport/__tests__/telegram.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { generateIdentity } from '../../identity/keypair.js'
import { createPeerRegistry } from '../../identity/peer-registry.js'
import { signMessage } from '../a2a-envelope.js'
import {
  createTelegramTransport,
  A2A_WIRE_PREFIX,
  type TelegramClient,
  type TelegramOutgoing,
  type TelegramIncoming,
} from '../telegram.js'
import type { A2AMessage } from '../../types.js'

// ─── Test stub: a paired Telegram client/bus ──────────────────────

interface StubChat {
  chatId: string | number
  members: Set<StubClient>
}

class StubChatNetwork {
  chats = new Map<string | number, StubChat>()

  registerChat(chatId: string | number): StubChat {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = { chatId, members: new Set() }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  deliver(senderTelegramId: string | number, msg: TelegramOutgoing): void {
    const chat = this.chats.get(msg.chatId)
    if (!chat) return
    for (const client of chat.members) {
      if (client.telegramId === senderTelegramId) continue // don't echo
      queueMicrotask(() => client.deliver({
        chatId: msg.chatId,
        senderTelegramId,
        text: msg.text,
      }))
    }
  }
}

class StubClient implements TelegramClient {
  private handlers = new Set<(msg: TelegramIncoming) => void>()

  constructor(
    public readonly telegramId: string | number,
    private network: StubChatNetwork,
    chatIds: (string | number)[],
  ) {
    for (const chatId of chatIds) {
      this.network.registerChat(chatId).members.add(this)
    }
  }

  async sendMessage(msg: TelegramOutgoing): Promise<void> {
    this.network.deliver(this.telegramId, msg)
  }

  onMessage(handler: (msg: TelegramIncoming) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  deliver(msg: TelegramIncoming): void {
    for (const h of this.handlers) {
      try { h(msg) } catch { /* swallow */ }
    }
  }

  async close(): Promise<void> {
    this.handlers.clear()
  }
}

function flush(times = 3): Promise<void> {
  let p = Promise.resolve()
  for (let i = 0; i < times; i++) p = p.then(() => new Promise(r => setTimeout(r, 5)))
  return p
}

// ─── Tests ────────────────────────────────────────────────────────

describe('createTelegramTransport', () => {
  let network: StubChatNetwork
  let groupChatId: string

  beforeEach(() => {
    network = new StubChatNetwork()
    groupChatId = 'group-' + Math.random().toString(36).slice(2, 8)
  })

  it('delivers a directed message between two agents through Telegram', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const aChat = 'dm-a-bot'
    const bChat = 'dm-b-bot'
    const aClient = new StubClient(100, network, [groupChatId, aChat])
    const bClient = new StubClient(200, network, [groupChatId, bChat])

    const tA = createTelegramTransport({
      identity: a,
      client: aClient,
      peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-B', groupChatId]]),
      broadcastChatId: groupChatId,
    })
    const tB = createTelegramTransport({
      identity: b,
      client: bClient,
      peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-A', groupChatId]]),
      broadcastChatId: groupChatId,
    })

    const received: A2AMessage[] = []
    tB.subscribe(msg => received.push(msg))

    await tA.send(signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: { role: 'tester' } },
      a,
    ))
    await flush()

    expect(received).toHaveLength(1)
    expect(received[0].from.agentId).toBe('agent-A')

    await tA.close()
    await tB.close()
  })

  it('marks A2A traffic with the COASTAL: prefix; ignores human chat', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const aClient = new StubClient(100, network, [groupChatId])
    const bClient = new StubClient(200, network, [groupChatId])

    const tB = createTelegramTransport({
      identity: b,
      client: bClient,
      peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-A', groupChatId]]),
      broadcastChatId: groupChatId,
    })

    const received: A2AMessage[] = []
    tB.subscribe(msg => received.push(msg))

    // Simulate a human sending plain text in the group chat — should be ignored
    await aClient.sendMessage({ chatId: groupChatId, text: 'hello world!' })
    await flush()
    expect(received).toEqual([])

    // Now send a real A2A message via the transport
    const tA = createTelegramTransport({
      identity: a,
      client: aClient,
      peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-B', groupChatId]]),
      broadcastChatId: groupChatId,
    })
    await tA.send(signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: null },
      a,
    ))
    await flush()
    expect(received).toHaveLength(1)

    await tA.close()
    await tB.close()
  })

  it('rejects oversized payloads at send time (4096 char limit)', async () => {
    const a = generateIdentity('agent-A')
    const aClient = new StubClient(100, network, [groupChatId])
    const tA = createTelegramTransport({
      identity: a,
      client: aClient,
      peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-B', groupChatId]]),
    })
    try {
      const oversize = signMessage(
        { to: 'agent-B', kind: 'task.complete', payload: { data: 'x'.repeat(5000) } },
        a,
      )
      await expect(tA.send(oversize)).rejects.toThrow(/too large/)
    } finally {
      await tA.close()
    }
  })

  it('drops tampered (bad signature) A2A messages', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const aClient = new StubClient(100, network, [groupChatId])
    const bClient = new StubClient(200, network, [groupChatId])

    const tB = createTelegramTransport({
      identity: b,
      client: bClient,
      peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-A', groupChatId]]),
      broadcastChatId: groupChatId,
    })
    const received: A2AMessage[] = []
    tB.subscribe(msg => received.push(msg))

    // Manually inject a tampered envelope via the chat
    const signed = signMessage(
      { to: 'agent-B', kind: 'task.claim', payload: { taskId: 'real' } },
      a,
    )
    const tampered = { ...signed, payload: { taskId: 'EVIL' } }
    const wire = A2A_WIRE_PREFIX + JSON.stringify(tampered)
    await aClient.sendMessage({ chatId: groupChatId, text: wire })
    await flush()
    expect(received).toEqual([])

    await tB.close()
  })

  it('broadcasts to the configured broadcastChatId', async () => {
    const a = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')
    const c = generateIdentity('agent-C')
    const aClient = new StubClient(100, network, [groupChatId])
    const bClient = new StubClient(200, network, [groupChatId])
    const cClient = new StubClient(300, network, [groupChatId])

    const tA = createTelegramTransport({
      identity: a, client: aClient, peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-B', groupChatId], ['agent-C', groupChatId]]),
      broadcastChatId: groupChatId,
    })
    const tB = createTelegramTransport({
      identity: b, client: bClient, peerRegistry: createPeerRegistry(),
      peerChats: new Map(), broadcastChatId: groupChatId,
    })
    const tC = createTelegramTransport({
      identity: c, client: cClient, peerRegistry: createPeerRegistry(),
      peerChats: new Map(), broadcastChatId: groupChatId,
    })

    const rcvB: A2AMessage[] = []
    const rcvC: A2AMessage[] = []
    tB.subscribe(m => rcvB.push(m))
    tC.subscribe(m => rcvC.push(m))

    await tA.send(signMessage(
      { to: '*', kind: 'agent.hello', payload: null },
      a,
    ))
    await flush()

    expect(rcvB).toHaveLength(1)
    expect(rcvC).toHaveLength(1)

    await tA.close()
    await tB.close()
    await tC.close()
  })

  it('TOFU peer-key registry blocks impersonation over Telegram', async () => {
    const realA = generateIdentity('agent-A')
    const imposter = generateIdentity('agent-A')
    const b = generateIdentity('agent-B')

    const aClient = new StubClient(100, network, [groupChatId])
    const bClient = new StubClient(200, network, [groupChatId])

    // agent-B already knows the real agent-A's pubkey
    const peerRegistry = createPeerRegistry()
    peerRegistry.recordOrVerify('agent-A', realA.publicKey)

    const tImposter = createTelegramTransport({
      identity: imposter, client: aClient, peerRegistry: createPeerRegistry(),
      peerChats: new Map([['agent-B', groupChatId]]), broadcastChatId: groupChatId,
    })
    const tB = createTelegramTransport({
      identity: b, client: bClient, peerRegistry,
      peerChats: new Map([['agent-A', groupChatId]]), broadcastChatId: groupChatId,
    })

    const received: A2AMessage[] = []
    tB.subscribe(m => received.push(m))

    await tImposter.send(signMessage(
      { to: 'agent-B', kind: 'task.cancel', payload: { taskId: 't-1' } },
      imposter,
    ))
    await flush()
    expect(received).toEqual([])

    await tImposter.close()
    await tB.close()
  })
})
