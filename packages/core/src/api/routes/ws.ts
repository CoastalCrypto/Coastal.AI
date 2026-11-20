import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { handleSessionWs } from '../ws/session.js'

export interface WsRoutesOptions {
  validateSession: (token: string) => boolean
}

export async function wsRoutes(fastify: FastifyInstance, opts: WsRoutesOptions) {
  // @fastify/websocket v9+ passes the raw ws WebSocket directly as the
  // handler's first argument — the v8-era SocketStream wrapper (a
  // {socket: WebSocket} object) was removed.
  fastify.get('/ws/session', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    handleSessionWs(socket, req, opts)
  })
}
