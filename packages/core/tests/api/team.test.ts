import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../../src/server.js'
import { invalidateConfig } from '../../src/config.js'
import { getOrCreateAdminToken } from '../../src/api/routes/admin.js'

// Regression coverage for the team.ts <-> server.ts wiring specifically —
// runTeamChain itself is unit-tested in src/agents/__tests__/run-team-chain.test.ts,
// but nothing exercised the real route: that teamRoutes receives the shared
// registry/router from app-context.ts (not constructing its own second
// ModelRouter/AgentRegistry the way the pre-decentralized-team BossAgent
// version did), and that the whole chain actually produces a trace through
// a live server + real auth gate.
vi.mock('../../src/models/router.js', () => ({
  ModelRouter: vi.fn().mockImplementation(() => ({
    cascade: { close: vi.fn() },
    ollama: {},
    chat: vi.fn().mockResolvedValue({ reply: JSON.stringify({ satisfied: true, note: 'ok' }), decision: {} }),
    chatWithTools: vi.fn().mockResolvedValue({ content: 'Direct answer, no handoff needed.', toolCalls: [] }),
    chatStream: vi.fn(),
    listModels: vi.fn().mockResolvedValue(['llama3.2']),
    close: vi.fn(),
  })),
}))

vi.mock('../../src/routing/domain-classifier.js', () => ({
  DomainClassifier: vi.fn().mockImplementation(() => ({
    classify: vi.fn().mockResolvedValue({ domain: 'general', confidence: 1, classifiedBy: 'rules' }),
  })),
}))

vi.mock('mem0ai', () => ({
  MemoryClient: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
  })),
}))

describe('POST /api/team/run', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let dataDir: string
  let adminToken: string
  const originalDataDir = process.env.CC_DATA_DIR

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-team-test-'))
    process.env.CC_DATA_DIR = dataDir
    invalidateConfig()
    adminToken = getOrCreateAdminToken(dataDir)
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

  it('runs the chain through the shared (not route-local) router/registry and returns a trace', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/team/run',
      headers: { 'x-admin-token': adminToken },
      payload: { task: 'plan the quarter' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.trace).toHaveLength(1)
    expect(body.trace[0]).toMatchObject({ agentId: 'general', reply: 'Direct answer, no handoff needed.' })
  })

  it('without a session or admin token, requires auth (operator role, same as chat/pipeline)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/team/run',
      payload: { task: 'plan the quarter' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a missing task with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/team/run',
      headers: { 'x-admin-token': adminToken },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
