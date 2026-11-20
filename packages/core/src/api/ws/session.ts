import type { FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'

export interface HandleSessionWsOptions {
  validateSession: (token: string) => boolean
}

const AUTH_TIMEOUT_MS = 5000

// @fastify/websocket v9+ passes the raw ws WebSocket directly as the
// handler's first argument (the v8-era SocketStream {socket: WebSocket}
// wrapper was removed).
//
// A browser's native WebSocket API can't attach a custom header to the
// upgrade handshake, so this route isn't gated by server.ts's onRequest
// hook — it authenticates itself here instead, via the client's first
// message, unconditionally (mirrors /ws/agent-events's handshake in
// agent-events.ts). Everything but an `{type:'auth'}` message is dropped
// until authenticated, with a timeout that closes the socket.
export function handleSessionWs(socket: WebSocket, _req: FastifyRequest, opts: HandleSessionWsOptions) {
  let authenticated = false

  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      console.warn('[ws/session] 1008 Unauthorized — no auth received within timeout')
      socket.close(1008, 'Unauthorized')
    }
  }, AUTH_TIMEOUT_MS)

  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'auth') {
        if (opts.validateSession(String(msg.token ?? ''))) {
          authenticated = true
          clearTimeout(authTimeout)
        }
        return
      }
      if (!authenticated) return // drop everything else until a valid {type:'auth'} message arrives
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
    clearTimeout(authTimeout)
  })
}
