import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../../src/server.js'
import { invalidateConfig } from '../../src/config.js'
import { getOrCreateAdminToken } from '../../src/api/routes/admin.js'

vi.mock('../../src/models/router.js', () => ({
  ModelRouter: vi.fn().mockImplementation(() => ({
    cascade: {
      route: vi.fn().mockResolvedValue({
        model: 'llama3.2', domain: 'general',
        signals: { relation: 'new', urgency: 'medium', actionability: 'act', retention: 'useful', confidence: 0 },
        domainConfidence: 0.5, classifiedBy: 'llm',
      }),
    },
    ollama: {},
    listModels: vi.fn().mockResolvedValue(['llama3.2']),
    close: vi.fn(),
  })),
}))

vi.mock('../../src/agents/loop.js', () => ({
  AgenticLoop: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      reply: 'Hello from the agent!',
      domain: 'general',
      status: 'complete',
      actions: [],
    }),
  })),
}))

vi.mock('mem0ai', () => ({
  MemoryClient: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([]),
  })),
}))

describe('POST /api/chat', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let dataDir: string
  let adminToken: string
  const originalDataDir = process.env.CC_DATA_DIR

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cc-chat-test-'))
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

  it('returns assistant reply', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-admin-token': adminToken },
      payload: {
        sessionId: 'test-session',
        message: 'hello',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.reply).toBe('Hello from the agent!')
    expect(body.sessionId).toBe('test-session')
  })

  it('rejects missing message with 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-admin-token': adminToken },
      payload: { sessionId: 'test' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('without a session or admin token, requires auth', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { sessionId: 'test', message: 'hello' },
    })
    expect(res.statusCode).toBe(401)
  })
})
