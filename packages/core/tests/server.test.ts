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

// Regression coverage for api/auth-policy.ts's deny-by-default posture.
// Finding #1 of the 2026-08-21 security audit was that these routes were
// never gated unless CC_HOST exposed the server off localhost — left wide
// open on the overwhelmingly common install (desktop app, `pnpm start` on a
// dev box). The fix removed the CC_HOST condition entirely: every route not
// in PUBLIC_ROUTES now requires a session at every bind address, localhost
// included, so this suite doesn't need to flip CC_HOST at all to exercise it.
describe('deny-by-default auth gate', () => {
  const guardedRoutes = [
    { method: 'POST' as const, url: '/api/team/run' },
    { method: 'GET' as const, url: '/api/sessions' },
    { method: 'GET' as const, url: '/api/search?q=x' },
    { method: 'GET' as const, url: '/api/persona' },
    // /api/events itself is a long-lived SSE stream that never completes a
    // normal request/response cycle — /api/events/history is a quick GET
    // under the same prefix, so it exercises the identical auth-gate branch.
    { method: 'GET' as const, url: '/api/events/history' },
    // /ws/session is NOT here — it's a WebSocket upgrade, gated by its own
    // first-message handshake instead of this header-based hook (browsers
    // can't attach a custom header to a WS upgrade). See ws.test.ts.
  ]

  let server: Awaited<ReturnType<typeof buildServer>>
  let dataDir: string
  let adminSession: string
  const originalDataDir = process.env.CC_DATA_DIR

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-deny-by-default-test-'))
    process.env.CC_DATA_DIR = dataDir
    invalidateConfig()
    server = await buildServer()
    await server.listen({ port: 0, host: '127.0.0.1' })

    // Past the mustChangePassword gate, so this session is usable outright —
    // admin outranks every route's required role, so one session is enough
    // to sanity-check that the gate opens for *somebody*, not just that it
    // closes for nobody.
    const login = await server.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin' },
    })
    const defaultToken = JSON.parse(login.body).sessionToken
    await server.inject({
      method: 'PATCH', url: '/api/auth/password', headers: { 'x-admin-session': defaultToken },
      payload: { currentPassword: 'admin', newPassword: 'a-real-password-123' },
    })
    const relogin = await server.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'a-real-password-123' },
    })
    adminSession = JSON.parse(relogin.body).sessionToken
  })

  afterAll(async () => {
    await server.close()
    if (originalDataDir === undefined) delete process.env.CC_DATA_DIR
    else process.env.CC_DATA_DIR = originalDataDir
    invalidateConfig()
    rmSync(dataDir, { recursive: true, force: true })
  })

  for (const { method, url } of guardedRoutes) {
    it(`${method} ${url} requires auth, even on a localhost-bound server`, async () => {
      const res = await server.inject({ method, url })
      expect(res.statusCode).toBe(401)
    })

    it(`${method} ${url} opens for a sufficiently-privileged session`, async () => {
      const res = await server.inject({ method, url, headers: { 'x-admin-session': adminSession } })
      expect(res.statusCode).not.toBe(401)
    })
  }

  it('/api/admin/* requires auth', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/admin/models' })
    expect(res.statusCode).toBe(401)
  })

  it('/api/health and /api/version stay reachable with no session', async () => {
    const health = await server.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    const version = await server.inject({ method: 'GET', url: '/api/version' })
    expect(version.statusCode).toBe(200)
  })

  it('a role below the route\'s requirement is rejected with 403, not 401', async () => {
    const createRes = await server.inject({
      method: 'POST', url: '/api/admin/users',
      headers: { 'x-admin-session': adminSession },
      payload: { username: 'a-viewer', password: 'a-real-password-123', role: 'viewer' },
    })
    expect(createRes.statusCode).toBe(201)
    const viewerLogin = await server.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'a-viewer', password: 'a-real-password-123' },
    })
    const viewerSession = JSON.parse(viewerLogin.body).sessionToken

    // /api/team/run is operator-and-above; a viewer session must be refused,
    // but refused as "wrong role", not "no credential at all".
    const res = await server.inject({
      method: 'POST', url: '/api/team/run',
      headers: { 'x-admin-session': viewerSession },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('forbidden')
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

// EventSource can't set a custom header, so gated SSE routes (/api/events,
// /api/pipeline/*/events) accept a short-lived, single-use ticket via
// ?ticket= instead. The ticket itself can only be minted through a normal
// (header-authenticated) POST, so this doesn't weaken the network-exposed
// gate — it just moves the credential from a header to a query param for
// the one transport that structurally cannot carry a header.
describe('SSE ticket auth (network-exposed)', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let dataDir: string
  let sessionToken: string
  const originalDataDir = process.env.CC_DATA_DIR
  const originalHost = process.env.CC_HOST

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-sse-ticket-test-'))
    process.env.CC_DATA_DIR = dataDir
    process.env.CC_HOST = '0.0.0.0'
    invalidateConfig()
    server = await buildServer()
    await server.listen({ port: 0, host: '127.0.0.1' })

    // Get a session past the mustChangePassword gate so it's usable outright.
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
    sessionToken = JSON.parse(relogin.body).sessionToken
  })

  afterAll(async () => {
    await server.close()
    if (originalDataDir === undefined) delete process.env.CC_DATA_DIR
    else process.env.CC_DATA_DIR = originalDataDir
    if (originalHost === undefined) delete process.env.CC_HOST
    else process.env.CC_HOST = originalHost
    invalidateConfig()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('POST /api/events/ticket requires auth (it is itself under isNetworkRoute)', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/events/ticket' })
    expect(res.statusCode).toBe(401)
  })

  it('mints a ticket with a valid session, then the ticket authenticates a gated GET', async () => {
    const mint = await server.inject({
      method: 'POST',
      url: '/api/events/ticket',
      headers: { 'x-admin-session': sessionToken },
    })
    expect(mint.statusCode).toBe(200)
    const { ticket } = JSON.parse(mint.body)
    expect(typeof ticket).toBe('string')

    // No x-admin-session at all here — only the ticket authenticates this request.
    const res = await server.inject({ method: 'GET', url: `/api/events/history?ticket=${ticket}` })
    expect(res.statusCode).not.toBe(401)
  })

  it('a ticket is single-use — the second attempt to use it is rejected', async () => {
    const mint = await server.inject({
      method: 'POST',
      url: '/api/events/ticket',
      headers: { 'x-admin-session': sessionToken },
    })
    const { ticket } = JSON.parse(mint.body)

    const first = await server.inject({ method: 'GET', url: `/api/events/history?ticket=${ticket}` })
    expect(first.statusCode).not.toBe(401)

    const second = await server.inject({ method: 'GET', url: `/api/events/history?ticket=${ticket}` })
    expect(second.statusCode).toBe(401)
  })

  it('an unknown ticket does not authenticate', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/events/history?ticket=not-a-real-ticket' })
    expect(res.statusCode).toBe(401)
  })
})

// CodeQL flagged the onRequest hook's timingSafeEqual/session-verification
// checks as an authorization path with no rate limiting (nothing stopped
// unlimited admin-token or session-token guesses). Own describe block with
// its own server, since the limiter's state is tied to one buildServer()
// instance and deliberately persists across requests within it — sharing
// a server with other auth tests would mean whichever ran first exhausts
// the budget for the rest.
describe('auth rate limiting', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let dataDir: string
  const originalDataDir = process.env.CC_DATA_DIR

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-auth-rate-limit-test-'))
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

  // Order matters within this describe block: both tests share one server,
  // and therefore one limiter instance keyed by the same injected-request
  // IP. Once the first test below trips the limiter for that IP, every
  // subsequent request from it gets 429 regardless of credentials — so the
  // "no credential is ever counted" test has to run first, while the
  // budget is still clean, not after.
  it('a request with no credential at all is never counted toward the failure budget', async () => {
    // Confirms the limiter is scoped to actual wrong-credential attempts,
    // not every unauthenticated request — otherwise a burst of ordinary,
    // uncredentialed browser traffic (checking if a session exists yet)
    // could lock a legitimate client out on its own.
    for (let i = 0; i < 25; i++) {
      const res = await server.inject({ method: 'GET', url: '/api/sessions' })
      expect(res.statusCode).toBe(401)
    }
  })

  it('a wrong x-admin-session eventually gets rate-limited to 429, not endlessly re-tried as 401', async () => {
    let lastStatus = 0
    // MAX_FAILURES_PER_WINDOW (auth-rate-limit.ts) is 20 — comfortably more
    // attempts than that proves the limiter actually engages rather than
    // relying on an exact count this test would need to track in lockstep
    // with that module's internal default.
    for (let i = 0; i < 25; i++) {
      const res = await server.inject({
        method: 'GET', url: '/api/sessions',
        headers: { 'x-admin-session': `not-a-real-session-${i}` },
      })
      lastStatus = res.statusCode
      if (lastStatus === 429) break
    }
    expect(lastStatus).toBe(429)
  })
})
