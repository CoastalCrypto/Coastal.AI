// packages/coordination/src/identity/peer-registry.ts
//
// TOFU (Trust On First Use) peer-key registry.
//
// Model: every time we see a peer's public key, we either RECORD it
// (first contact) or VERIFY it matches what we already have (locked).
// A mismatch is grounds to drop the message and log loudly — it means
// either a key rotation we weren't told about, or impersonation.
//
// Persistence: writes a flat JSON file under the daemon's dataDir.
// Phase 2 uses this for in-process tests + the first BC-250 pairing;
// Phase 4 cluster scale-out may want a real KV store (sqlite) but the
// flat file is fine up to a few hundred peers.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs'
import { dirname } from 'node:path'

export interface VerifyResult {
  trusted: boolean
  /** Populated when trusted === false. */
  reason?: string
  /**
   * True iff this was the first time we've seen this agentId
   * (TOFU recorded). Callers may want to surface a one-time UI
   * notice ("new peer paired: agent-A") on first contact.
   */
  firstContact?: boolean
}

export interface PeerRegistry {
  /**
   * The combined "look up or record + verify" operation. The common
   * call site is the transport layer's inbound message handler.
   */
  recordOrVerify(agentId: string, publicKey: string): VerifyResult

  /** Read the locked public key for an agent, if any. */
  get(agentId: string): string | undefined

  /** Remove a peer (e.g., received a signed agent.goodbye). */
  forget(agentId: string): void

  /** All currently-known peer agentIds. */
  list(): string[]

  /**
   * Persist to disk if a persistencePath was configured. No-op for
   * in-memory registries (tests). Safe to call repeatedly.
   */
  flush(): Promise<void>
}

interface RegistryFile {
  schema: 'coastal-peer-registry/v1'
  peers: Record<string, string>
  updatedAt: number
}

export interface PeerRegistryConfig {
  /**
   * If supplied, the registry loads from this path on creation and
   * persists writes back to it. Without it, the registry is purely
   * in-memory (useful for tests).
   */
  persistencePath?: string
}

export function createPeerRegistry(config: PeerRegistryConfig = {}): PeerRegistry {
  const peers = new Map<string, string>()
  const { persistencePath } = config

  if (persistencePath && existsSync(persistencePath)) {
    try {
      const raw = readFileSync(persistencePath, 'utf8')
      const parsed = JSON.parse(raw) as RegistryFile
      if (parsed.schema !== 'coastal-peer-registry/v1') {
        throw new Error(`unknown schema: ${parsed.schema}`)
      }
      for (const [k, v] of Object.entries(parsed.peers ?? {})) peers.set(k, v)
    } catch (e) {
      // Corrupt or unreadable — start fresh rather than refuse to boot.
      // The daemon will re-TOFU peers on first contact.
      // (A more paranoid registry would refuse to boot here; that's a
      // policy choice for Phase 4+.)
      console.warn(`[peer-registry] could not load ${persistencePath}: ${(e as Error).message}; starting fresh`)
    }
  }

  let dirty = false

  const writeFlushFile = (): Promise<void> => {
    if (!persistencePath || !dirty) return Promise.resolve()
    const data: RegistryFile = {
      schema: 'coastal-peer-registry/v1',
      peers: Object.fromEntries(peers.entries()),
      updatedAt: Date.now(),
    }
    mkdirSync(dirname(persistencePath), { recursive: true })
    writeFileSync(persistencePath, JSON.stringify(data, null, 2), 'utf8')
    dirty = false
    return Promise.resolve()
  }

  return {
    recordOrVerify(agentId, publicKey): VerifyResult {
      const known = peers.get(agentId)
      if (!known) {
        peers.set(agentId, publicKey)
        dirty = true
        // Best-effort persist on first contact; failure shouldn't
        // block the verify path.
        void writeFlushFile().catch(() => { /* swallowed */ })
        return { trusted: true, firstContact: true }
      }
      if (known === publicKey) {
        return { trusted: true, firstContact: false }
      }
      return {
        trusted: false,
        firstContact: false,
        reason: `pubkey mismatch for agent ${agentId} (known vs presented)`,
      }
    },
    get(agentId) {
      return peers.get(agentId)
    },
    forget(agentId) {
      if (peers.delete(agentId)) {
        dirty = true
        void writeFlushFile().catch(() => { /* swallowed */ })
      }
    },
    list() {
      return Array.from(peers.keys()).sort()
    },
    flush: writeFlushFile,
  }
}
