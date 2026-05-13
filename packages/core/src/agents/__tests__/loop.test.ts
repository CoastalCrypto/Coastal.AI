import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgenticLoop } from '../loop.js'
import type { AgentSession } from '../session.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { PermissionGate } from '../permission-gate.js'
import type { ActionLog } from '../action-log.js'

const mockSession = (tools: string[] = ['read_file']) => ({
  agent: { id: 'cto', tools, builtIn: true, active: true, createdAt: 0, name: 'CTO', role: 'Eng', soulPath: '' },
  systemPrompt: '# CTO',
  toolSchemas: [],
  actions: [],
  buildMessages: (msg: string, hist: any[]) => [{ role: 'system', content: '# CTO' }, ...hist, { role: 'user', content: msg }],
  recordAction: vi.fn(),
  actionSummary: () => '',
  invalidateSoulCache: vi.fn(),
  getTrustLevel: () => null,
}) as unknown as AgentSession

const mockRegistry = (executor?: (name: string, args: any) => Promise<string>) => ({
  get: vi.fn(),
  isReversible: (name: string) => name === 'read_file',
  execute: executor ?? (async () => 'file contents'),
  getDefinition: vi.fn(),
  getDefinitionsFor: () => [],
}) as unknown as ToolRegistry

const mockGate = (decision = 'allow') => ({
  evaluate: vi.fn().mockReturnValue(decision),
  setAlwaysAllow: vi.fn(),
  createPendingApproval: vi.fn().mockReturnValue({
    approvalId: 'test-id',
    promise: Promise.resolve('approved'),
  }),
  resolveApproval: vi.fn(),
}) as unknown as PermissionGate

const mockLog = () => ({
  record: vi.fn(),
  getForSession: vi.fn().mockReturnValue([]),
}) as unknown as ActionLog

describe('AgenticLoop', () => {
  it('returns reply when no tool calls', async () => {
    const ollama = { chatWithTools: vi.fn().mockResolvedValue({ content: 'hello', toolCalls: [] }) } as any
    const loop = new AgenticLoop(ollama, mockRegistry(), mockGate(), mockLog())
    const result = await loop.run(mockSession(), 'hi', 'sess-1', [])
    expect(result.reply).toBe('hello')
    expect(result.actions).toHaveLength(0)
  })

  it('executes one tool call and loops', async () => {
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'tc1', name: 'read_file', args: { path: '/x' } }] })
        .mockResolvedValueOnce({ content: 'done', toolCalls: [] }),
    } as any
    const loop = new AgenticLoop(ollama, mockRegistry(), mockGate('allow'), mockLog())
    const result = await loop.run(mockSession(['read_file']), 'check file', 'sess-1', [])
    expect(result.reply).toBe('done')
    expect(ollama.chatWithTools).toHaveBeenCalledTimes(2)
  })

  it('stops at CC_AGENT_MAX_TURNS', async () => {
    process.env.CC_AGENT_MAX_TURNS = '2'
    const ollama = {
      chatWithTools: vi.fn().mockResolvedValue({
        content: '',
        toolCalls: [{ id: 'tc1', name: 'read_file', args: {} }],
      }),
    } as any
    const loop = new AgenticLoop(ollama, mockRegistry(), mockGate('allow'), mockLog())
    const result = await loop.run(mockSession(['read_file']), 'loop', 'sess-1', [])
    expect(result.reply).toContain('maximum turns')
    expect(ollama.chatWithTools).toHaveBeenCalledTimes(2)  // ADD THIS
    delete process.env.CC_AGENT_MAX_TURNS
  })

  it('returns BLOCK result to LLM without executing', async () => {
    const executor = vi.fn()
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'tc1', name: 'forbidden_tool', args: {} }] })
        .mockResolvedValueOnce({ content: 'understood', toolCalls: [] }),
    } as any
    const registry = mockRegistry(executor as any)
    const loop = new AgenticLoop(ollama, registry, mockGate('block'), mockLog())
    const result = await loop.run(mockSession([]), 'try forbidden', 'sess-1', [])
    expect(executor).not.toHaveBeenCalled()
    expect(result.reply).toBe('understood')
  })

  it('executes all read tools in a batch turn', async () => {
    const executionOrder: string[] = []
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [
            { id: 'tc1', name: 'read_file', args: { path: '/a' } },
            { id: 'tc2', name: 'read_file', args: { path: '/b' } },
          ],
        })
        .mockResolvedValueOnce({ content: 'done', toolCalls: [] }),
    } as any
    const executor = vi.fn().mockImplementation(async (name, args) => {
      executionOrder.push(args.path as string)
      return 'content'
    })
    const registry = mockRegistry(executor)
    const loop = new AgenticLoop(ollama, registry, mockGate('allow'), mockLog())
    const result = await loop.run(mockSession(['read_file']), 'read both', 'sess-1', [])
    expect(result.reply).toBe('done')
    expect(executor).toHaveBeenCalledTimes(2)
    expect(executionOrder).toHaveLength(2)
  })

  it('handles QUEUE timeout — returns error to LLM and loop continues', async () => {
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'tc1', name: 'write_file', args: {} }] })
        .mockResolvedValueOnce({ content: 'ok after timeout', toolCalls: [] }),
    } as any
    const gate = {
      evaluate: vi.fn().mockReturnValue('queued'),
      setAlwaysAllow: vi.fn(),
      createPendingApproval: vi.fn().mockReturnValue({
        approvalId: 'test-id',
        promise: Promise.resolve('timeout'),
      }),
      resolveApproval: vi.fn(),
    } as unknown as PermissionGate
    const loop = new AgenticLoop(ollama, mockRegistry(), gate, mockLog())
    const result = await loop.run(mockSession(['write_file']), 'write something', 'sess-1', [])
    expect(result.reply).toBe('ok after timeout')
    expect(ollama.chatWithTools).toHaveBeenCalledTimes(2)
  })

  it('handles QUEUE denied — returns error to LLM and loop continues', async () => {
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'tc1', name: 'write_file', args: {} }] })
        .mockResolvedValueOnce({ content: 'ok after denial', toolCalls: [] }),
    } as any
    const gate = {
      evaluate: vi.fn().mockReturnValue('queued'),
      setAlwaysAllow: vi.fn(),
      createPendingApproval: vi.fn().mockReturnValue({
        approvalId: 'test-id',
        promise: Promise.resolve('denied'),
      }),
      resolveApproval: vi.fn(),
    } as unknown as PermissionGate
    const loop = new AgenticLoop(ollama, mockRegistry(), gate, mockLog())
    const result = await loop.run(mockSession(['write_file']), 'write something', 'sess-1', [])
    expect(result.reply).toBe('ok after denial')
    expect(ollama.chatWithTools).toHaveBeenCalledTimes(2)
  })

  it('truncates tool output at CC_TOOL_RESULT_MAX_CHARS', async () => {
    process.env.CC_TOOL_RESULT_MAX_CHARS = '10'
    const longOutput = 'a'.repeat(100)
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'tc1', name: 'read_file', args: { path: '/x' } }] })
        .mockImplementationOnce(async (_model, messages) => {
          // Check that the tool message content was truncated
          const toolMsg = messages.find((m: any) => m.role === 'tool')
          expect(toolMsg?.content).toHaveLength(10)
          return { content: 'done', toolCalls: [] }
        }),
    } as any
    const registry = mockRegistry(async () => longOutput)
    const loop = new AgenticLoop(ollama, registry, mockGate('allow'), mockLog())
    await loop.run(mockSession(['read_file']), 'read', 'sess-1', [])
    delete process.env.CC_TOOL_RESULT_MAX_CHARS
  })

  it('includes tool_call_id on tool result messages', async () => {
    const ollama = {
      chatWithTools: vi.fn()
        .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'my-tc-id', name: 'read_file', args: { path: '/x' } }] })
        .mockImplementationOnce(async (_model, messages) => {
          const toolMsg = messages.find((m: any) => m.role === 'tool')
          expect(toolMsg?.tool_call_id).toBe('my-tc-id')
          return { content: 'done', toolCalls: [] }
        }),
    } as any
    const loop = new AgenticLoop(ollama, mockRegistry(), mockGate('allow'), mockLog())
    await loop.run(mockSession(['read_file']), 'read', 'sess-1', [])
  })
})
