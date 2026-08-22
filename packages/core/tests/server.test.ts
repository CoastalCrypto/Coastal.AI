import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { invalidateConfig } from '../src/config.js'

describe('health endpoint', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    server = await buildServer()
    await server.listen({ port: 0, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await server.close()
  })

  it('GET /health returns 200 with status ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
    expect(body.version).toBeDefined()
  })
})

// Regression coverage for the auth hook's isNetworkRoute set. These routes hand
// out agent/tool execution or cross-session data — Finding #1 of the 2026-08-21
// security audit was that they were never gated even when CC_HOST exposes the
// server off localhost.
describe('network-exposed auth gate', () => {
  const guardedRoutes = [
    { method: 'POST' as const, url: '/api/team/run' },
    { method: 'GET' as const, url: '/api/sessions' },
    { method: 'GET' as const, url: '/api/search?q=x' },
    { method: 'GET' as const, url: '/api/persona' },
    // /api/events itself is a long-lived SSE stream that never completes a
    // normal request/response cycle — /api/events/history is a quick GET
    // under the same prefix, so it exercises the identical auth-gate branch.
    { method: 'GET' as const, url: '/api/events/history' },
    { method: 'GET' as const, url: '/ws/session' },
  ]

  describe('when CC_HOST is localhost (default)', () => {
    let server: Awaited<ReturnType<typeof buildServer>>

    beforeAll(async () => {
      invalidateConfig()
      server = await buildServer()
      await server.listen({ port: 0, host: '127.0.0.1' })
    })

    afterAll(async () => {
      await server.close()
    })

    for (const { method, url } of guardedRoutes) {
      it(`${method} ${url} is NOT gated (unchanged local-only behavior)`, async () => {
        const res = await server.inject({ method, url })
        expect(res.statusCode).not.toBe(401)
      })
    }
  })

  describe('when CC_HOST exposes the server off localhost', () => {
    let server: Awaited<ReturnType<typeof buildServer>>
    const originalHost = process.env.CC_HOST

    beforeAll(async () => {
      process.env.CC_HOST = '0.0.0.0'
      invalidateConfig()
      server = await buildServer()
      await server.listen({ port: 0, host: '127.0.0.1' })
    })

    afterAll(async () => {
      await server.close()
      if (originalHost === undefined) delete process.env.CC_HOST
      else process.env.CC_HOST = originalHost
      invalidateConfig()
    })

    for (const { method, url } of guardedRoutes) {
      it(`${method} ${url} requires auth without a session`, async () => {
        const res = await server.inject({ method, url })
        expect(res.statusCode).toBe(401)
      })
    }

    it('/api/admin/* still requires auth (unaffected by this fix)', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/admin/models' })
      expect(res.statusCode).toBe(401)
    })
  })
})

// Finding #2 of the 2026-08-21 security audit: the seeded default admin/admin
// account's mustChangePassword flag was only enforced by the React UI, never
// by the server — a session token from that account was fully usable against
// /api/admin/* forever, regardless of whether the change-password screen was
// ever shown. Each test here gets its own fresh CC_DATA_DIR so the seeded
// admin account's mustChangePassword state can't leak between runs/describes.
describe('mustChangePassword server-side enforcement', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let dataDir: string
  const originalDataDir = process.env.CC_DATA_DIR

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-password-gate-test-'))
    process.env.CC_DATA_DIR = dataDir
    invalidateConfig()
    server = await buildServer()
    await server.listen({ port: 0, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await server.close()
    if (originalDataDir === undefined) delete process.env.CC_DATA_DIR
    else process.env.CC_DATA_DIR = originalDataDir
    invalidateConfig()
    rmSync(dataDir, { recursive: true, force: true })
  })

  async function loginAsDefaultAdmin(): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    return JSON.parse(res.body).sessionToken
  }

  it('a fresh admin/admin session cannot reach /api/admin/* — 403 password_change_required, not a silent 200', async () => {
    const sessionToken = await loginAsDefaultAdmin()
    const res = await server.inject({
      method: 'GET',
      url: '/api/admin/models',
      headers: { 'x-admin-session': sessionToken },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('password_change_required')
  })

  it('/api/auth/me still works with that same session (not blocked)', async () => {
    const sessionToken = await loginAsDefaultAdmin()
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'x-admin-session': sessionToken },
    })
    expect(res.statusCode).toBe(200)
  })

  it('after changing the password via /api/auth/password, a new session can reach /api/admin/*', async () => {
    const sessionToken = await loginAsDefaultAdmin()

    const changeRes = await server.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { 'x-admin-session': sessionToken },
      payload: { currentPassword: 'admin', newPassword: 'a-real-password-123' },
    })
    expect(changeRes.statusCode).toBe(200)

    const newLogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'a-real-password-123' },
    })
    expect(newLogin.statusCode).toBe(200)
    const newSessionToken = JSON.parse(newLogin.body).sessionToken

    const adminRes = await server.inject({
      method: 'GET',
      url: '/api/admin/models',
      headers: { 'x-admin-session': newSessionToken },
    })
    expect(adminRes.statusCode).toBe(200)
  })
})
