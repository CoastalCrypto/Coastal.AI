import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelRouter } from '../../src/models/router.js'

const mockAnthropicChat = vi.fn().mockResolvedValue('claude reply')
const mockAnthropicChatWithTools = vi.fn().mockResolvedValue({ content: 'claude tool reply', toolCalls: [] })

vi.mock('../../src/models/ollama.js', () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    listModels: vi.fn().mockResolvedValue(['llama3.2', 'mistral']),
    chat: vi.fn().mockResolvedValue('mocked response'),
    chatWithTools: vi.fn().mockResolvedValue({ content: 'mocked response', toolCalls: [] }),
  })),
}))

vi.mock('../../src/models/anthropic.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/models/anthropic.js')>('../../src/models/anthropic.js')
  return {
    ...actual,
    AnthropicClient: vi.fn().mockImplementation(() => ({
      chat: mockAnthropicChat,
      chatWithTools: mockAnthropicChatWithTools,
    })),
  }
})

vi.mock('../../src/routing/cascade.js', () => ({
  CascadeRouter: vi.fn().mockImplementation(() => ({
    route: vi.fn().mockResolvedValue({
      model: 'llama3.2', fallbackModels: [], domain: 'general',
      signals: { relation: 'new', urgency: 'medium', actionability: 'act', retention: 'useful', confidence: 0 },
      domainConfidence: 0.5, classifiedBy: 'llm',
    }),
    close: vi.fn(),
  })),
}))

describe('ModelRouter', () => {
  it('routes to default model when none specified', async () => {
    const router = new ModelRouter({ ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2' })
    const { reply } = await router.chat([{ role: 'user', content: 'hi' }])
    expect(reply).toBe('mocked response')
  })

  it('routes to specified model', async () => {
    const router = new ModelRouter({ ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2' })
    const { reply } = await router.chat([{ role: 'user', content: 'hi' }], { model: 'mistral' })
    expect(reply).toBe('mocked response')
  })

  it('lists available models', async () => {
    const router = new ModelRouter({ ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2' })
    const models = await router.listModels()
    expect(models).toContain('llama3.2')
  })

  it('returns { reply, decision } with RouteDecision', async () => {
    const router = new ModelRouter({ ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2' })
    const result = await router.chat([{ role: 'user', content: 'hi' }])
    expect(result).toHaveProperty('reply')
    expect(result).toHaveProperty('decision')
    expect(result.reply).toBe('mocked response')
    expect(result.decision).toHaveProperty('model')
    expect(result.decision).toHaveProperty('signals')
  })
})

describe('ModelRouter: Anthropic routing', () => {
  beforeEach(() => {
    mockAnthropicChat.mockClear()
    mockAnthropicChatWithTools.mockClear()
  })

  it('chatWithTools("claude-...") routes to the Anthropic client, not the Ollama/vLLM/AirLLM cascade', async () => {
    const router = new ModelRouter({
      ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2', anthropicApiKey: 'sk-ant-test',
    })
    const result = await router.chatWithTools('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }], [])
    expect(result.content).toBe('claude tool reply')
    expect(mockAnthropicChatWithTools).toHaveBeenCalledWith('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }], [])
  })

  it('chat({model: "claude-..."}) also routes to Anthropic', async () => {
    const router = new ModelRouter({
      ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2', anthropicApiKey: 'sk-ant-test',
    })
    const { reply } = await router.chat([{ role: 'user', content: 'hi' }], { model: 'claude-sonnet-4-5' })
    expect(reply).toBe('claude reply')
  })

  it('a non-claude model never touches the Anthropic client, even when a key is configured', async () => {
    const router = new ModelRouter({
      ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2', anthropicApiKey: 'sk-ant-test',
    })
    await router.chatWithTools('llama3.2', [{ role: 'user', content: 'hi' }], [])
    expect(mockAnthropicChatWithTools).not.toHaveBeenCalled()
  })

  it('throws a clear, specific error for a claude model when no API key is configured', async () => {
    const router = new ModelRouter({ ollamaUrl: 'http://localhost:11434', defaultModel: 'llama3.2' })
    await expect(router.chatWithTools('claude-sonnet-4-5', [{ role: 'user', content: 'hi' }], []))
      .rejects.toThrow(/Anthropic.*ANTHROPIC_API_KEY/)
  })
})
