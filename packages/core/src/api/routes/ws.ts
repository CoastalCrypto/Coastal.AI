import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import { handleSessionWs } from '../ws/session.js'

export interface WsRoutesOptions {
  isNetworkExposed: boolean
  validateSession: (token: string) => boolean
}

export async function wsRoutes(fastify: FastifyInstance, opts: WsRoutesOptions) {
  fastify.get('/ws/session', { websocket: true }, (connection: SocketStream, req: FastifyRequest) => {
    handleSessionWs(connection, req, opts)
  })
}
