// packages/coordination/src/transport/mdns.ts
//
// mDNS-based peer discovery for the Coastal.AI swarm. Uses
// bonjour-service (pure-JS, no system avahi dependency required).
//
// Each daemon publishes itself as a `_coastal-ai._tcp.local` service
// with TXT records carrying its agentId, role, publicKey hash, and
// protocol version. Other daemons on the same multicast network
// discover the service and feed peer endpoints into the TCP transport's
// addPeer().
//
// Why bonjour-service over avahi-daemon:
//   - Portable across Linux/macOS/Windows without system service deps
//   - No dbus juggling
//   - Single npm dep; deterministic across the cluster
//   - Phase 4+ can swap in avahi if we need richer per-OS integration

// bonjour-service uses `export = Bonjour` (CJS-style). Under strict ESM
// in Node 22+ we have to default-import and extract types from the class
// rather than importing them as named exports.
import Bonjour from 'bonjour-service'
import { createHash } from 'node:crypto'

type Service = ReturnType<Bonjour['publish']>
type BrowserConfig = NonNullable<Parameters<Bonjour['find']>[0]>
type ServiceConfig = Bonjour.ServiceConfig
import { EventEmitter } from 'node:events'
import type { AgentIdentity } from '../types.js'
import { A2A_PROTOCOL_VERSION } from '../types.js'

export const COASTAL_AI_MDNS_TYPE = 'coastal-ai'
export const COASTAL_AI_MDNS_PROTOCOL = 'tcp'

export interface DiscoveredPeer {
  agentId: string
  address: string
  port: number
  /** Declared role from the peer's TXT record. */
  role?: string
  /** SHA-256 of the peer's publicKey (16 hex chars, truncated). Defends
   *  against accidental publicKey-change without going through key rotation. */
  publicKeyHash?: string
  /** A2A protocol version declared by the peer. */
  protocolVersion?: string
}

export interface MdnsConfig {
  identity: AgentIdentity
  /** TCP port the local transport is listening on. */
  port: number
  /** Optional role label (e.g. 'main', 'coder') for the TXT record. */
  role?: string
  /** Override service type for test isolation (default: 'coastal-ai'). */
  serviceType?: string
  /** Bonjour instance to share — created internally if omitted. */
  bonjour?: Bonjour
}

export interface MdnsDiscovery {
  /** Subscribe to peer-up events. Returns unsubscribe. */
  onPeer(handler: (peer: DiscoveredPeer) => void): () => void
  /** Subscribe to peer-lost events. */
  onPeerLost(handler: (agentId: string) => void): () => void
  /** Currently-known peers. */
  listPeers(): DiscoveredPeer[]
  /** Stop publishing + browsing. */
  stop(): Promise<void>
}

export function publicKeyShortHash(publicKeyBase64: string): string {
  return createHash('sha256').update(publicKeyBase64).digest('hex').slice(0, 16)
}

export function createMdnsDiscovery(config: MdnsConfig): MdnsDiscovery {
  const {
    identity,
    port,
    role,
    serviceType = COASTAL_AI_MDNS_TYPE,
    bonjour: providedBonjour,
  } = config

  const bonjour = providedBonjour ?? new Bonjour()
  const ownedBonjour = !providedBonjour
  const peers = new Map<string, DiscoveredPeer>()
  const events = new EventEmitter()
  events.setMaxListeners(0)

  // ─── publish ───────────────────────────────────────────────────────

  const txt: Record<string, string> = {
    agentId: identity.agentId,
    pkh: publicKeyShortHash(identity.publicKey),
    proto: A2A_PROTOCOL_VERSION,
  }
  if (role) txt.role = role

  const serviceConfig: ServiceConfig = {
    name: `coastal-${identity.agentId}`,
    type: serviceType,
    protocol: COASTAL_AI_MDNS_PROTOCOL,
    port,
    txt,
  }
  const service: Service = bonjour.publish(serviceConfig)

  // ─── browse ────────────────────────────────────────────────────────

  const browserConfig: BrowserConfig = {
    type: serviceType,
    protocol: COASTAL_AI_MDNS_PROTOCOL,
  }
  const browser = bonjour.find(browserConfig)

  const fromService = (svc: Service): DiscoveredPeer | null => {
    const txtRecord = (svc.txt ?? {}) as Record<string, string>
    const agentId = txtRecord.agentId
    if (!agentId) return null
    if (agentId === identity.agentId) return null // skip self
    // bonjour-service exposes .addresses[]; prefer IPv4
    const addresses = (svc as unknown as { addresses?: string[] }).addresses ?? []
    const address = addresses.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a))
      ?? addresses[0]
      ?? svc.host
    return {
      agentId,
      address,
      port: svc.port,
      role: txtRecord.role,
      publicKeyHash: txtRecord.pkh,
      protocolVersion: txtRecord.proto,
    }
  }

  browser.on('up', (svc: Service) => {
    const peer = fromService(svc)
    if (!peer) return
    peers.set(peer.agentId, peer)
    events.emit('peer', peer)
  })

  browser.on('down', (svc: Service) => {
    const txtRecord = (svc.txt ?? {}) as Record<string, string>
    const agentId = txtRecord.agentId
    if (!agentId || agentId === identity.agentId) return
    if (peers.delete(agentId)) {
      events.emit('peer-lost', agentId)
    }
  })

  return {
    onPeer(handler) {
      events.on('peer', handler)
      return () => events.off('peer', handler)
    },
    onPeerLost(handler) {
      events.on('peer-lost', handler)
      return () => events.off('peer-lost', handler)
    },
    listPeers() {
      return Array.from(peers.values())
    },
    async stop() {
      await new Promise<void>(resolve => service.stop(() => resolve()))
      browser.stop()
      if (ownedBonjour) {
        bonjour.destroy()
      }
    },
  }
}
