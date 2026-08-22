import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CoreClient } from './client'

globalThis.fetch = vi.fn()

// jsdom provides sessionStorage — seed it before creating admin clients
const SESSION_TOKEN = 'test-session-token'

describe('CoreClient', () => {
  const client = new CoreClient('http://localhost:4747')

  it('sendMessage returns reply and sessionId', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: 'hi there', sessionId: 'sess-123' }),
    } as Response)
    const result = await client.sendMessage({ message: 'hello' })
    expect(result.reply).toBe('hi there')
    expect(result.sessionId).toBe('sess-123')
  })

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as Response)
    await expect(client.sendMessage({ message: 'hello' })).rejects.toThrow()
  })
})

describe('CoreClient admin methods', () => {
  let client: CoreClient

  beforeEach(() => {
    sessionStorage.setItem('cc_admin_session', SESSION_TOKEN)
    client = new CoreClient('http://localhost:4747')
  })

  it('listModels returns grouped model array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ baseName: 'codestral:22b', hfSource: 'mistralai/Codestral-22B', variants: [] }],
    } as Response)
    const result = await client.listModels()
    expect(result).toHaveLength(1)
    expect(result[0].baseName).toBe('codestral:22b')
    expect(result[0].hfSource).toBe('mistralai/Codestral-22B')
  })

  it('removeModel sends DELETE request with session token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
    await client.removeModel('codestral:22b-Q4_K_M')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/models/'),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'x-admin-session': SESSION_TOKEN }),
      })
    )
  })

  it('updateRegistry sends PATCH request with session token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ ok: true }),
    } as Response)
    await client.updateRegistry({ cfo: { high: 'model-a', medium: 'model-b', low: 'model-c' } })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/registry'),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'x-admin-session': SESSION_TOKEN }),
      })
    )
  })

  it('addModel sends POST request with hfModelId and quants', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ message: 'Pipeline started' }),
    } as Response)
    await client.addModel('owner/mymodel', ['Q4_K_M'], 'sess-1')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/models/add'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('owner/mymodel'),
        headers: expect.objectContaining({ 'x-admin-session': SESSION_TOKEN }),
      })
    )
  })

  it('getRegistry returns current registry assignments', async () => {
    const mockRegistry = { cfo: { high: 'model-a', medium: 'model-b', low: 'model-c' } }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => mockRegistry,
    } as Response)
    const result = await client.getRegistry()
    expect(result).toEqual(mockRegistry)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/registry'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-admin-session': SESSION_TOKEN }),
      })
    )
  })

  // Regression: /api/persona is auth-gated on network-exposed servers
  // (server.ts's isNetworkRoute). The client must send the session token
  // or every persona read/write 401s the moment CC_HOST leaves localhost.
  it('getPersona sends session token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ persona: {}, configured: true }),
    } as Response)
    await client.getPersona()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/persona'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-session': SESSION_TOKEN }),
      })
    )
  })

  it('setPersona sends session token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ persona: {}, configured: true }),
    } as Response)
    await client.setPersona({ agentName: 'Max' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/persona'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'x-admin-session': SESSION_TOKEN }),
      })
    )
  })
})
