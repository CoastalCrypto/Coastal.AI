import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { architectControlRoutes } from '../architect-controls.js'
import { openArchitectDb } from '../../../architect/db.js'
import { UserProfileStore } from '../../../architect/user-profile/store.js'

let app: FastifyInstance
let tempDir: string
let db: Database.Database
let profileStore: UserProfileStore

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'arch-controls-route-'))
  db = openArchitectDb(join(tempDir, 'architect.db'))
  profileStore = new UserProfileStore(db)
  app = Fastify({ logger: false })
  await app.register(architectControlRoutes, { dataDir: tempDir, profileStore })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  if (db && db.open) db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('GET /api/admin/architect/status', () => {
  it("returns power:off and mode derived from the seeded profile (hands-on)", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/architect/status' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.power).toBe('off')
    // Default profile knobs match the hands-on preset.
    expect(body.mode).toBe('hands-on')
  })

  it('returns power:on when pid file exists', async () => {
    writeFileSync(join(tempDir, '.architect-pid'), '12345')
    const res = await app.inject({ method: 'GET', url: '/api/admin/architect/status' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).power).toBe('on')
  })

  it("returns 'custom' when a mode-controlled knob drifts off-preset", async () => {
    profileStore.update('default', { testStrictness: 'advisory' })
    const res = await app.inject({ method: 'GET', url: '/api/admin/architect/status' })
    expect(JSON.parse(res.body).mode).toBe('custom')
  })

  it('ignores drift in non-mode knobs (tone change keeps mode stable)', async () => {
    profileStore.update('default', { tone: 'terse' })
    const res = await app.inject({ method: 'GET', url: '/api/admin/architect/status' })
    expect(JSON.parse(res.body).mode).toBe('hands-on')
  })
})

describe('POST /api/admin/architect/mode', () => {
  it('writes the autopilot preset into the profile', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/mode',
      payload: { mode: 'autopilot' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, mode: 'autopilot' })

    const profile = profileStore.getDefault()
    expect(profile.gatePolicy).toBe('merge-only')
    expect(profile.autoApproveThreshold).toBe('aggressive')
    expect(profile.testStrictness).toBe('warn')
  })

  it('subsequent GET /status reflects the written mode', async () => {
    await app.inject({
      method: 'POST', url: '/api/admin/architect/mode',
      payload: { mode: 'hands-off' },
    })
    const res = await app.inject({ method: 'GET', url: '/api/admin/architect/status' })
    expect(JSON.parse(res.body).mode).toBe('hands-off')
  })

  it("'custom' is accepted but does not modify any knob", async () => {
    await app.inject({
      method: 'POST', url: '/api/admin/architect/mode',
      payload: { mode: 'autopilot' },
    })
    const beforeCustom = profileStore.getDefault()
    await app.inject({
      method: 'POST', url: '/api/admin/architect/mode',
      payload: { mode: 'custom' },
    })
    const afterCustom = profileStore.getDefault()
    expect(afterCustom.gatePolicy).toBe(beforeCustom.gatePolicy)
    expect(afterCustom.autoApproveThreshold).toBe(beforeCustom.autoApproveThreshold)
    expect(afterCustom.testStrictness).toBe(beforeCustom.testStrictness)
  })

  it('does not touch knobs outside the engagement axis', async () => {
    profileStore.update('default', { tone: 'terse', riskPosture: 'experimental' })
    await app.inject({
      method: 'POST', url: '/api/admin/architect/mode',
      payload: { mode: 'hands-off' },
    })
    const profile = profileStore.getDefault()
    expect(profile.tone).toBe('terse')
    expect(profile.riskPosture).toBe('experimental')
  })

  it('rejects invalid mode values', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/mode',
      payload: { mode: 'invalid-mode' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts all four valid mode values', async () => {
    const modes = ['hands-on', 'hands-off', 'autopilot', 'custom']
    for (const mode of modes) {
      const res = await app.inject({
        method: 'POST', url: '/api/admin/architect/mode',
        payload: { mode },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).mode).toBe(mode)
    }
  })
})

describe('POST /api/admin/architect/power', () => {
  it('returns ok:true with power state', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/power',
      payload: { state: 'on' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, power: 'on' })
  })

  it('creates shutdown signal file when power is off and pid exists', async () => {
    writeFileSync(join(tempDir, '.architect-pid'), '12345')
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/power',
      payload: { state: 'off' },
    })
    expect(res.statusCode).toBe(200)
    expect(existsSync(join(tempDir, '.architect-shutdown'))).toBe(true)
  })

  it('does not create shutdown signal when power off but no pid file', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/power',
      payload: { state: 'off' },
    })
    expect(res.statusCode).toBe(200)
    expect(existsSync(join(tempDir, '.architect-shutdown'))).toBe(false)
  })

  it('rejects invalid state values', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/power',
      payload: { state: 'invalid' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/admin/architect/run-now', () => {
  it('creates run-now signal file and returns ok:true', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/architect/run-now',
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.message).toBe('Tick requested')
    expect(existsSync(join(tempDir, '.architect-run-now'))).toBe(true)
  })
})
