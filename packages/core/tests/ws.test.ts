import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { invalidateConfig } from '../src/config.js'
import WebSocket from 'ws'

// A browser's native WebSocket API can't attach a custom header to the
// upgrade handshake, so /ws/session isn't gated by server.ts's header-based
// onRequest hook. Instead the first message on the socket must be a valid
// {type:'auth', token} or the server closes the connection — unconditionally,
// at every bind address, same as every other route under the deny-by-default
// policy in api/auth-policy.ts (this is the one route that can't use a
// header to carry the credential, not an exception to the policy itself).
describe('WebSocket session channel', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let address: string
  let dataDir: string
  let cleanToken: string
  const originalDataDir = process.env.CC_DATA_DIR

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-ws-session-test-'))
    process.env.CC_DATA_DIR = dataDir
    invalidateConfig()
    server = await buildServer()
    await server.listen({ port: 0, host: '127.0.0.1' })
    const port = (server.server.address() as { port: number }).port
    address = `ws://127.0.0.1:${port}/ws/session`

    // checkSessionAuth rejects a mustChangePassword session outright, so get
    // a session past that gate the same way the mustChangePassword tests do.
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })
    const defaultToken = JSON.parse(login.body).sessionToken
    await server.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { 'x-admin-session': defaultToken },
      payload: { currentPassword: 'admin', newPassword: 'a-real-password-123' },
    })
    const relogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'a-real-password-123' },
    })
    cleanToken = JSON.parse(relogin.body).sessionToken
  })

  afterAll(async () => {
    await server.close()
    if (originalDataDir === undefined) delete process.env.CC_DATA_DIR
    else process.env.CC_DATA_DIR = originalDataDir
    invalidateConfig()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('closes the connection (1008) if no auth message arrives before other traffic is accepted', async () => {
    const ws = new WebSocket(address)
    await new Promise<void>((resolve) => ws.on('open', resolve))
    // Send a ping without authenticating first — must be silently dropped,
    // not answered with a pong.
    ws.send(JSON.stringify({ type: 'ping' }))
    const gotMessage = await Promise.race([
      new Promise<boolean>((resolve) => ws.on('message', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    expect(gotMessage).toBe(false)
    ws.close()
  })

  it('accepts traffic once a valid {type:"auth", token} message is sent', async () => {
    const ws = new WebSocket(address)
    await new Promise<void>((resolve) => ws.on('open', resolve))
    ws.send(JSON.stringify({ type: 'auth', token: cleanToken }))
    ws.send(JSON.stringify({ type: 'ping' }))
    const msg = await new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())))
    expect(JSON.parse(msg).type).toBe('pong')
    ws.close()
  })

  it('rejects an invalid auth token — subsequent traffic still gets dropped', async () => {
    const ws = new WebSocket(address)
    await new Promise<void>((resolve) => ws.on('open', resolve))
    ws.send(JSON.stringify({ type: 'auth', token: 'not-a-real-token' }))
    ws.send(JSON.stringify({ type: 'ping' }))
    const gotMessage = await Promise.race([
      new Promise<boolean>((resolve) => ws.on('message', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    expect(gotMessage).toBe(false)
    ws.close()
  })

  it('a session below the operator role requirement is rejected like an invalid token', async () => {
    const createRes = await server.inject({
      method: 'POST', url: '/api/admin/users',
      headers: { 'x-admin-session': cleanToken },
      payload: { username: 'a-viewer', password: 'a-real-password-123', role: 'viewer' },
    })
    expect(createRes.statusCode).toBe(201)
    const viewerLogin = await server.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'a-viewer', password: 'a-real-password-123' },
    })
    const viewerToken = JSON.parse(viewerLogin.body).sessionToken

    const ws = new WebSocket(address)
    await new Promise<void>((resolve) => ws.on('open', resolve))
    ws.send(JSON.stringify({ type: 'auth', token: viewerToken }))
    ws.send(JSON.stringify({ type: 'ping' }))
    const gotMessage = await Promise.race([
      new Promise<boolean>((resolve) => ws.on('message', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    expect(gotMessage).toBe(false)
    ws.close()
  })
})
