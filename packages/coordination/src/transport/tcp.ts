// packages/coordination/src/transport/tcp.ts
//
// TCP-backed A2A transport. Same A2ATransport interface as the
// localhost transport — the daemon code doesn't care which it's
// holding.
//
// Wire format: length-prefixed JSON.
//   4 bytes big-endian uint32 = payload length in bytes
//   N bytes UTF-8 JSON = canonicalized A2AMessage envelope
//
// This is intentionally trivial: Python and Rust agents can implement
// the same wire in <50 lines. Strict JCS canonicalization would be a
// nicer-to-have (cross-language signature parity for arbitrary
// payloads), but Phase 2 only needs Node↔Node and our payload set is
// fixed enums + strings + integers.
//
// Connection model: each daemon runs a TCP server (accepts inbound)
// and maintains outbound connections to known peers. Bidirectional
// per pair — 2 sockets per peer pair, 22 sockets total in a 12-node
// cluster. Trivial overhead.
//
// Reconnect: exponential backoff (1s, 2s, 4s, ...) capped at 30s,
// reset to 1s on successful connect. Sockets are pooled per
// agentId — first connection wins, additional connects are dropped.

import { createServer, type Server, type Socket, connect } from 'node:net'
import type { A2AMessage, AgentIdentity } from '../types.js'
import type { A2ATransport } from './types.js'
import { verifyMessage } from './a2a-envelope.js'
import type { PeerRegistry } from '../identity/peer-registry.js'

export interface TcpPeer {
  agentId: string
  address: string
  port: number
}

export interface TcpTransportConfig {
  identity: AgentIdentity
  /** Port to listen on. 0 = OS picks ephemeral (recommended). */
  port?: number
  /** Address to bind. Default: '0.0.0.0' (all interfaces). */
  bindAddress?: string
  /**
   * TOFU peer-key registry. The transport calls
   * `recordOrVerify(from.agentId, from.publicKey)` on every inbound
   * message and drops the message if not trusted.
   */
  peerRegistry: PeerRegistry
  /**
   * Peers to actively connect to on startup. In Phase 2 these are
   * hand-configured; in Phase 4 the mDNS discovery layer feeds new
   * entries in via addPeer().
   */
  initialPeers?: TcpPeer[]
  /** Reconnect backoff start (ms). Default 1000. */
  reconnectBaseMs?: number
  /** Reconnect backoff max (ms). Default 30_000. */
  reconnectMaxMs?: number
}

export interface TcpTransport extends A2ATransport {
  /** Add (or update) a peer endpoint. Establishes a connection if not already connected. */
  addPeer(peer: TcpPeer): void
  /** Drop a peer's connection and remove from the active set. */
  removePeer(agentId: string): void
  /** Actual port the server is listening on (resolves ephemeral). */
  getServerPort(): number
  /** Currently-connected peer agentIds. */
  connectedPeers(): string[]
}

interface OutboundConnection {
  agentId: string
  address: string
  port: number
  socket: Socket | null
  reconnectMs: number
  reconnectTimer: NodeJS.Timeout | null
  /** Queued frames waiting for the socket to come up. */
  pending: Buffer[]
}

const FRAME_HEADER_BYTES = 4
const MAX_FRAME_BYTES = 16 * 1024 * 1024 // 16 MB — well above any realistic A2A message
const MAX_PENDING_PER_PEER = 100         // drop oldest beyond this; an offline peer shouldn't OOM us

/**
 * Create and start a TCP A2A transport. Resolves once the server is
 * listening (so the caller can read getServerPort()).
 */
export function createTcpTransport(config: TcpTransportConfig): Promise<TcpTransport> {
  const {
    identity,
    bindAddress = '0.0.0.0',
    peerRegistry,
    initialPeers = [],
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30_000,
  } = config

  const subscribers = new Set<(msg: A2AMessage) => void>()
  const inboundSockets = new Set<Socket>()
  const outbound = new Map<string, OutboundConnection>()
  let serverPort = 0
  let server: Server | null = null
  let closed = false

  // ─── inbound: server accepting connections ──────────────────────────

  const handleInbound = (socket: Socket) => {
    inboundSockets.add(socket)
    setupFrameReader(socket, (msg) => dispatch(msg))
    socket.on('close', () => inboundSockets.delete(socket))
    socket.on('error', () => { /* swallowed — close handler will run */ })
  }

  // ─── dispatch: verify + fan out to subscribers ──────────────────────

  const dispatch = (msg: A2AMessage) => {
    // Filter: only deliver messages addressed to this agent or broadcast.
    if (msg.to !== '*' && msg.to !== identity.agentId) return
    // TOFU verify against the peer registry
    const tofu = peerRegistry.recordOrVerify(msg.from.agentId, msg.from.publicKey)
    if (!tofu.trusted) return
    // Signature verify (canonical envelope match)
    const sig = verifyMessage(msg, { knownPublicKey: msg.from.publicKey })
    if (!sig.valid) return
    for (const handler of subscribers) {
      try { handler(msg) } catch { /* misbehaving handler — swallow */ }
    }
  }

  // ─── outbound: connection pool + reconnect ──────────────────────────

  const connectPeer = (entry: OutboundConnection) => {
    if (closed) return
    if (entry.socket && !entry.socket.destroyed) return // already connected

    const sock = connect({ host: entry.address, port: entry.port }, () => {
      entry.socket = sock
      entry.reconnectMs = reconnectBaseMs // reset backoff on success
      // Flush any queued frames
      for (const frame of entry.pending) sock.write(frame)
      entry.pending = []
    })
    sock.on('error', () => { /* close handler covers reconnect */ })
    sock.on('close', () => {
      if (entry.socket === sock) entry.socket = null
      if (closed) return
      // Schedule reconnect with backoff
      entry.reconnectTimer = setTimeout(() => {
        entry.reconnectTimer = null
        entry.reconnectMs = Math.min(entry.reconnectMs * 2, reconnectMaxMs)
        connectPeer(entry)
      }, entry.reconnectMs)
      entry.reconnectTimer.unref()
    })
    // Inbound frames on outbound sockets? Yes — same socket carries both
    // directions until/unless we split. The remote may broadcast over
    // this socket back to us.
    setupFrameReader(sock, (msg) => dispatch(msg))
  }

  const enqueueFrame = (entry: OutboundConnection, frame: Buffer) => {
    if (entry.socket && !entry.socket.destroyed) {
      entry.socket.write(frame)
      return
    }
    entry.pending.push(frame)
    if (entry.pending.length > MAX_PENDING_PER_PEER) {
      entry.pending.shift() // drop oldest
    }
  }

  const addPeer = (peer: TcpPeer) => {
    if (peer.agentId === identity.agentId) return // never connect to self
    const existing = outbound.get(peer.agentId)
    if (existing) {
      // Update endpoint if changed; if it changed, force a reconnect
      if (existing.address !== peer.address || existing.port !== peer.port) {
        existing.address = peer.address
        existing.port = peer.port
        existing.socket?.destroy()
      }
      return
    }
    const entry: OutboundConnection = {
      agentId: peer.agentId,
      address: peer.address,
      port: peer.port,
      socket: null,
      reconnectMs: reconnectBaseMs,
      reconnectTimer: null,
      pending: [],
    }
    outbound.set(peer.agentId, entry)
    connectPeer(entry)
  }

  const removePeer = (agentId: string) => {
    const entry = outbound.get(agentId)
    if (!entry) return
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
    entry.socket?.destroy()
    outbound.delete(agentId)
  }

  // ─── send: frame and dispatch ───────────────────────────────────────

  const sendFrame = async (msg: A2AMessage): Promise<void> => {
    const json = JSON.stringify(msg)
    const payload = Buffer.from(json, 'utf8')
    if (payload.length > MAX_FRAME_BYTES) {
      throw new Error(`tcp transport: frame too large (${payload.length} > ${MAX_FRAME_BYTES})`)
    }
    const header = Buffer.alloc(FRAME_HEADER_BYTES)
    header.writeUInt32BE(payload.length, 0)
    const frame = Buffer.concat([header, payload])

    if (msg.to === '*') {
      // Broadcast — write to all known outbound peers
      for (const entry of outbound.values()) {
        enqueueFrame(entry, frame)
      }
    } else {
      const entry = outbound.get(msg.to)
      if (!entry) {
        // Unknown peer — drop the message silently. (A more elaborate
        // transport would queue these for resolution via mDNS, but
        // Phase 2's contract is: addPeer first, then send.)
        return
      }
      enqueueFrame(entry, frame)
    }
  }

  // ─── start the server ───────────────────────────────────────────────

  return new Promise((resolve, reject) => {
    server = createServer(handleInbound)
    server.on('error', reject)
    server.listen(config.port ?? 0, bindAddress, () => {
      const addr = server!.address()
      if (typeof addr === 'string' || !addr) {
        reject(new Error('tcp transport: failed to bind'))
        return
      }
      serverPort = addr.port
      // Connect to any initial peers
      for (const peer of initialPeers) addPeer(peer)

      const transport: TcpTransport = {
        async send(msg) { await sendFrame(msg) },
        subscribe(handler) {
          subscribers.add(handler)
          return () => subscribers.delete(handler)
        },
        async close() {
          closed = true
          for (const entry of outbound.values()) {
            if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
            entry.socket?.destroy()
          }
          outbound.clear()
          for (const s of inboundSockets) s.destroy()
          inboundSockets.clear()
          subscribers.clear()
          await new Promise<void>((res) => server!.close(() => res()))
        },
        addPeer,
        removePeer,
        getServerPort() { return serverPort },
        connectedPeers() {
          return Array.from(outbound.entries())
            .filter(([, e]) => e.socket && !e.socket.destroyed)
            .map(([id]) => id)
        },
      }
      resolve(transport)
    })
  })
}

// ─── framing helpers ───────────────────────────────────────────────

/**
 * Attach a length-prefixed frame reader to a socket. Buffers partial
 * frames; calls `onFrame` once per complete message. Closes the socket
 * if a frame violates MAX_FRAME_BYTES (defensive against memory
 * exhaustion attacks).
 */
function setupFrameReader(socket: Socket, onFrame: (msg: A2AMessage) => void): void {
  let buffer = Buffer.alloc(0)
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= FRAME_HEADER_BYTES) {
      const len = buffer.readUInt32BE(0)
      if (len > MAX_FRAME_BYTES) {
        socket.destroy(new Error(`frame exceeds MAX_FRAME_BYTES: ${len}`))
        return
      }
      if (buffer.length < FRAME_HEADER_BYTES + len) return // wait for more
      const payload = buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + len)
      buffer = buffer.subarray(FRAME_HEADER_BYTES + len)
      try {
        const msg = JSON.parse(payload.toString('utf8')) as A2AMessage
        onFrame(msg)
      } catch {
        // Bad JSON — drop the frame, keep the connection (could be
        // a single corrupt frame).
      }
    }
  })
}
