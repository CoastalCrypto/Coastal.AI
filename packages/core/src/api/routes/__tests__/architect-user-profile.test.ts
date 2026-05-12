import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildServer } from '../../../server.js'
import { invalidateConfig } from '../../../config.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

vi.mock('../../../models/quantizer.js', () => ({
  QuantizationPipeline: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(undefined),
  })),
}))

describe('Architect user-profile API', () => {
  let server: FastifyInstance
  let tmpDir: string
  const token = 'test-admin-token'

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-userprofile-'))
    process.env.CC_DATA_DIR = tmpDir
    process.env.CC_ADMIN_TOKEN = token
    invalidateConfig()
    server = await buildServer()
    await server.listen({ port: 0 })
  })

  afterEach(async () => {
    await server.close()
    delete process.env.CC_DATA_DIR
    delete process.env.CC_ADMIN_TOKEN
    invalidateConfig()
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  function authed(method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) {
    return server.inject({
      method, url, headers: { 'x-admin-token': token, 'content-type': 'application/json' },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  it('GET /api/admin/architect/user-profile returns the default profile', async () => {
    const res = await authed('GET', '/api/admin/architect/user-profile')
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe('default')
    expect(body.tone).toBe('standard')
    expect(body.riskPosture).toBe('balanced')
  })

  it('requires admin token', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/admin/architect/user-profile' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /api/admin/architect/user-profile/questions returns 7 questions', async () => {
    const res = await authed('GET', '/api/admin/architect/user-profile/questions')
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.questions).toHaveLength(7)
    expect(body.questions[0]).toHaveProperty('id')
    expect(body.questions[0]).toHaveProperty('options')
  })

  it('PUT applies a partial patch and returns the updated profile', async () => {
    const res = await authed('PUT', '/api/admin/architect/user-profile', {
      tone: 'terse', riskPosture: 'experimental',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.tone).toBe('terse')
    expect(body.riskPosture).toBe('experimental')
    expect(body.planVerbosity).toBe('standard')
  })

  it('PUT rejects invalid enum values with 400', async () => {
    const res = await authed('PUT', '/api/admin/architect/user-profile', {
      tone: 'shouting',
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('invalid_payload')
  })

  it('PUT rejects unknown keys via .strict() schema with 400', async () => {
    const res = await authed('PUT', '/api/admin/architect/user-profile', {
      tone: 'terse', mood: 'happy',
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /wizard accepts wizard answers and applies valid ones', async () => {
    const res = await authed('POST', '/api/admin/architect/user-profile/wizard', {
      answers: {
        tone: 'terse',
        riskPosture: 'experimental',
        bogus: 'ignored',
        planVerbosity: 'shouting',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.applied.sort()).toEqual(['riskPosture', 'tone'])
    expect(body.profile.tone).toBe('terse')
    expect(body.profile.planVerbosity).toBe('standard') // invalid value rejected
  })
})
