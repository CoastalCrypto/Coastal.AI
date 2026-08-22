import type { FastifyRequest } from 'fastify'
import type { SocketStream } from '@fastify/websocket'

export interface HandleSessionWsOptions {
  isNetworkExposed: boolean
  validateSession: (token: string) => boolean
}

const AUTH_TIMEOUT_MS = 5000

// @fastify/websocket v8 passes a SocketStream; the raw WebSocket is at connection.socket
//
// A browser's native WebSocket API can't attach a custom header to the
// upgrade handshake, so this route isn't gated by server.ts's onRequest
// hook — it authenticates itself here instead, via the client's first
// message, only when the server is actually network-exposed. On a
// localhost-only install this is a no-op (authenticated starts true), same
// as it's always behaved.
export function handleSessionWs(connection: SocketStream, _req: FastifyRequest, opts: HandleSessionWsOptions) {
  const socket = connection.socket
  let authenticated = !opts.isNetworkExposed

  const authTimeout = opts.isNetworkExposed
    ? setTimeout(() => {
        if (!authenticated) {
          console.warn('[ws/session] 1008 Unauthorized — no auth received within timeout')
          socket.close(1008, 'Unauthorized')
        }
      }, AUTH_TIMEOUT_MS)
    : undefined

  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'auth') {
        if (opts.validateSession(String(msg.token ?? ''))) {
          authenticated = true
          if (authTimeout) clearTimeout(authTimeout)
        }
        return
      }
      if (!authenticated) return // drop everything else until authenticated (network-exposed only)
      if (msg.type === 'register' && typeof msg.sessionId === 'string') {
        // Validate format to prevent session hijacking
        if (/^[a-zA-Z0-9_-]{8,128}$/.test(msg.sessionId)) {
          ;(socket as any)._sessionId = msg.sessionId
        }
        return
      }
      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
      }
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'invalid json' }))
    }
  })

  socket.on('close', () => {
    if (authTimeout) clearTimeout(authTimeout)
  })
}
