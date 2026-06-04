// packages/coordination/src/transport/telegram.ts
//
// A2A transport over Telegram. Phase 5 deliverable — lets a node on a
// different LAN join the swarm via a shared Telegram chat without
// requiring direct network connectivity.
//
// Wire format:
//   Each A2A envelope is JSON-stringified, prefixed with the magic
//   header "COASTAL:" + version byte, then sent as a Telegram text
//   message. The header lets the receiver distinguish A2A traffic
//   from human chat in the same group.
//
// Constraints (Telegram Bot API):
//   - Text messages capped at 4096 chars. Envelopes that exceed this
//     are rejected at send time. Larger payloads would need to be
//     chunked or sent as document attachments; v0.0.x doesn't.
//   - Per-bot rate limit: ~30 msgs/s. For high-volume agent traffic,
//     fall back to LAN A2A; Telegram is for off-LAN coordination
//     only.
//   - Out-of-order delivery is possible — the logical-clock guards
//     on upsertTask / upsertClaim (see ./replication/) handle this.
//
// Dependency injection:
//   This module does NOT depend on telegraf or any specific Telegram
//   client library. It defines a minimal TelegramClient interface;
//   the application wires a concrete client (telegraf, grammy, or
//   even a custom polling implementation). Tests use a stub.

import type { A2AMessage, AgentIdentity } from '../types.js'
import type { A2ATransport } from './types.js'
import { verifyMessage } from './a2a-envelope.js'
import type { PeerRegistry } from '../identity/peer-registry.js'

/** Maximum chars in a Telegram text message. */
const TELEGRAM_TEXT_LIMIT = 4096
/** Prefix that marks a Telegram message as A2A traffic. */
export const A2A_WIRE_PREFIX = 'COASTAL:1:'

// ─── Telegram client abstraction ───────────────────────────────────

export interface TelegramOutgoing {
  chatId: string | number
  text: string
}

export interface TelegramIncoming {
  chatId: string | number
  /** Telegram user/bot ID of the sender. Not the same as the agent ID. */
  senderTelegramId: string | number
  text: string
}

export interface TelegramClient {
  sendMessage(msg: TelegramOutgoing): Promise<void>
  /** Subscribe to inbound messages from any chat the client is in. */
  onMessage(handler: (msg: TelegramIncoming) => void): () => void
  /** Cleanup (close polling, etc). */
  close(): Promise<void>
}

// ─── Transport ────────────────────────────────────────────────────

export interface TelegramTransportConfig {
  identity: AgentIdentity
  client: TelegramClient
  peerRegistry: PeerRegistry
  /**
   * Maps agentId → Telegram chatId. The transport uses this for
   * directed sends. For broadcasts, broadcastChatId is used.
   */
  peerChats: Map<string, string | number>
  /**
   * Chat used for broadcasts (`to === '*'`). Typically a group chat
   * the bot and all peer agents are in. Without this, broadcasts
   * fan out to every entry in peerChats individually (more API calls,
   * but works without a shared group).
   */
  broadcastChatId?: string | number
}

export function createTelegramTransport(config: TelegramTransportConfig): A2ATransport {
  const { identity, client, peerRegistry, peerChats, broadcastChatId } = config

  const subscribers = new Set<(msg: A2AMessage) => void>()

  const handleIncoming = (incoming: TelegramIncoming) => {
    if (!incoming.text.startsWith(A2A_WIRE_PREFIX)) return // not A2A traffic
    const payload = incoming.text.slice(A2A_WIRE_PREFIX.length)
    let parsed: A2AMessage
    try {
      parsed = JSON.parse(payload) as A2AMessage
    } catch {
      return // malformed; ignore
    }
    if (parsed.to !== '*' && parsed.to !== identity.agentId) return
    // TOFU verify
    const tofu = peerRegistry.recordOrVerify(parsed.from.agentId, parsed.from.publicKey)
    if (!tofu.trusted) return
    // Signature verify
    const sig = verifyMessage(parsed, { knownPublicKey: parsed.from.publicKey })
    if (!sig.valid) return
    for (const handler of subscribers) {
      try { handler(parsed) } catch { /* swallow */ }
    }
  }

  const unsubscribeFromClient = client.onMessage(handleIncoming)

  return {
    async send(msg: A2AMessage): Promise<void> {
      const json = JSON.stringify(msg)
      const wire = A2A_WIRE_PREFIX + json
      if (wire.length > TELEGRAM_TEXT_LIMIT) {
        throw new Error(
          `telegram transport: message too large (${wire.length} > ${TELEGRAM_TEXT_LIMIT}). ` +
          `Use LAN transport for high-volume traffic; Telegram is for off-LAN coordination.`,
        )
      }
      if (msg.to === '*') {
        if (broadcastChatId !== undefined) {
          await client.sendMessage({ chatId: broadcastChatId, text: wire })
        } else {
          // Fan out individually
          for (const chatId of peerChats.values()) {
            await client.sendMessage({ chatId, text: wire })
          }
        }
      } else {
        const chatId = peerChats.get(msg.to)
        if (chatId === undefined) return // unknown peer; drop silently
        await client.sendMessage({ chatId, text: wire })
      }
    },
    subscribe(handler) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },
    async close() {
      subscribers.clear()
      unsubscribeFromClient()
      await client.close()
    },
  }
}
