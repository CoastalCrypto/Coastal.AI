import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
