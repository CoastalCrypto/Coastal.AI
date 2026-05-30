// packages/coordination/src/transport/localhost.ts
//
// In-process A2A transport for Phase 1 tests and same-machine two-
// daemon smoke runs. Multiple transports share a single `LocalhostBus`;
// each transport corresponds to one agent.
//
// Signature verification happens here, not in the bus — that mirrors
// what TCP transport will do in Phase 2 (verify on receive, drop on
// fail).

import { EventEmitter } from 'node:events'
import type { A2AMessage, AgentIdentity } from '../types.js'
import type { A2ATransport } from './types.js'
import { verifyMessage } from './a2a-envelope.js'

/**
 * Shared event bus that multiple LocalhostTransport instances connect
 * to. In tests, you create one bus and N transports with different
 * identities. In production, the same role is played by TCP + mDNS.
 */
export class LocalhostBus {
  private emitter = new EventEmitter()

  constructor() {
    // No upper bound on listeners — coordination daemons may attach
    // many handlers for different message kinds.
    this.emitter.setMaxListeners(0)
  }

  /** Internal — called by transports on send(). */
  emit(msg: A2AMessage): void {
    // Use queueMicrotask so send() returns before the handler fires —
    // matches the async semantics of a real network transport.
    queueMicrotask(() => this.emitter.emit('message', msg))
  }

  /** Internal — called by transports on subscribe(). */
  on(handler: (msg: A2AMessage) => void): () => void {
    this.emitter.on('message', handler)
    return () => this.emitter.off('message', handler)
  }
}

export interface LocalhostTransportConfig {
  bus: LocalhostBus
  identity: AgentIdentity
  /**
   * Optional TOFU peer-key registry. Maps agentId → known public key.
   * If a message declares a pubkey that doesn't match the registry
   * entry, verification fails. Pass an empty map and let the caller
   * populate it as agents are discovered.
   */
  peerKeys?: Map<string, string>
  /**
   * Whether to deliver messages back to the sender. Defaults to false
   * — agents don't normally process their own broadcasts.
   */
  echo?: boolean
}

export function createLocalhostTransport(config: LocalhostTransportConfig): A2ATransport {
  const { bus, identity, peerKeys, echo = false } = config
  const subscribers = new Set<(msg: A2AMessage) => void>()

  const dispatch = (msg: A2AMessage) => {
    // Filter: only deliver messages addressed to this agent or
    // broadcast.
    if (msg.to !== '*' && msg.to !== identity.agentId) return
    // Filter: don't echo own messages unless explicitly requested.
    if (!echo && msg.from.agentId === identity.agentId) return
    // Verify signature (and TOFU key match if we know this peer).
    const knownPublicKey = peerKeys?.get(msg.from.agentId)
    const result = verifyMessage(msg, { knownPublicKey })
    if (!result.valid) {
      // Drop silently — production-grade transports would log/alarm,
      // but the v0.0.x default is to ignore and rely on monitor agents
      // to notice missing heartbeats.
      return
    }
    for (const handler of subscribers) {
      try {
        handler(msg)
      } catch {
        // A misbehaving handler shouldn't take out the bus. Errors are
        // swallowed; in production we'd surface via observability.
      }
    }
  }

  const off = bus.on(dispatch)

  return {
    async send(msg: A2AMessage): Promise<void> {
      bus.emit(msg)
    },
    subscribe(handler: (msg: A2AMessage) => void): () => void {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },
    async close(): Promise<void> {
      subscribers.clear()
      off()
    },
  }
}
