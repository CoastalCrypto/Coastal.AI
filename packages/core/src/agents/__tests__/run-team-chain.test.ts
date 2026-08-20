// packages/core/src/agents/__tests__/run-team-chain.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runTeamChain, type RunTeamChainDeps } from '../run-team-chain.js'
import { TeamChannel } from '../team-channel.js'
import { NoteStore } from '../../memory/notes.js'
import type { AgentConfig } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function makeAgent(id: string, name: string): AgentConfig {
  return {
    id, name, role: '', tools: [], builtIn: true, active: true, createdAt: 0,
    // Real soul files ship in packages/core/src/agents/souls/ — reuse them so
    // AgentSession.systemPrompt can actually read a file instead of needing a
    // filesystem mock.
    soulPath: join(__dirname, '..', 'souls', `SOUL_${id.toUpperCase()}.md`),
  }
}

const FOUR_AGENTS: Record<string, AgentConfig> = {
  cto: makeAgent('cto', 'Chief Technology Officer'),
  cfo: makeAgent('cfo', 'Chief Financial Officer'),
  coo: makeAgent('coo', 'Chief Operating Officer'),
  general: makeAgent('general', 'General Assistant'),
}

function baseDeps(overrides: Partial<RunTeamChainDeps> = {}): RunTeamChainDeps {
  return {
    router: { chatWithTools: vi.fn(), chat: vi.fn() } as any,
    registry: {
      get: vi.fn((id: string) => FOUR_AGENTS[id] ?? null),
      list: vi.fn(() => Object.values(FOUR_AGENTS)),
    } as any,
    noteStore: { search: vi.fn().mockReturnValue([]), create: vi.fn() } as any,
    channel: new TeamChannel(),
    classifier: { classify: vi.fn().mockResolvedValue({ domain: 'cto', confidence: 0.9, classifiedBy: 'rules' }) } as any,
    defaultModel: 'llama3.2',
    ...overrides,
  }
}

describe('runTeamChain', () => {
  let deps: RunTeamChainDeps

  beforeEach(() => {
    deps = baseDeps()
  })

  it('single turn, no handoff', async () => {
    ;(deps.router.chatWithTools as any).mockResolvedValueOnce({ content: 'direct answer', toolCalls: [] })

    const trace = await runTeamChain(deps, 'do a thing')

    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({ agentId: 'cto', agentName: 'Chief Technology Officer', reply: 'direct answer' })
    expect(trace[0].unresolved).toBeUndefined()
    expect(deps.noteStore.create).toHaveBeenCalledTimes(1)
  })

  it('two-hop handoff with verification satisfied', async () => {
    ;(deps.router.chatWithTools as any)
      .mockResolvedValueOnce({
        content: 'I need budget input',
        toolCalls: [{ id: '1', name: 'handoff', args: { targetAgentId: 'cfo', expectation: 'Provide a cost estimate' } }],
      })
      .mockResolvedValueOnce({ content: 'Estimate is $5k', toolCalls: [] })
    ;(deps.router.chat as any).mockResolvedValueOnce({ reply: '{"satisfied": true, "note": "gave a number"}', decision: {} })

    const trace = await runTeamChain(deps, 'plan a project')

    expect(trace).toHaveLength(2)
    expect(trace[0]).toMatchObject({ agentId: 'cto', handoffTo: 'cfo', expectation: 'Provide a cost estimate' })
    expect(trace[1]).toMatchObject({
      agentId: 'cfo', reply: 'Estimate is $5k', unresolved: false, verificationNote: 'gave a number',
    })
  })

  it('unsatisfied verification triggers exactly one retry, then marks unresolved', async () => {
    ;(deps.router.chatWithTools as any)
      .mockResolvedValueOnce({
        content: 'ask cfo',
        toolCalls: [{ id: '1', name: 'handoff', args: { targetAgentId: 'cfo', expectation: 'Give a number' } }],
      })
      .mockResolvedValueOnce({ content: 'I am not sure', toolCalls: [] }) // cfo, first attempt
      .mockResolvedValueOnce({ content: 'Still unsure', toolCalls: [] }) // cfo, retry
    ;(deps.router.chat as any)
      .mockResolvedValueOnce({ reply: '{"satisfied": false, "note": "no number given"}', decision: {} })
      .mockResolvedValueOnce({ reply: '{"satisfied": false, "note": "still no number"}', decision: {} })

    const trace = await runTeamChain(deps, 'plan a project')

    expect(trace).toHaveLength(3)
    expect(trace[1]).toMatchObject({ reply: 'I am not sure', unresolved: true, verificationNote: 'no number given' })
    expect(trace[2]).toMatchObject({ reply: 'Still unsure', unresolved: true, verificationNote: 'still no number' })
    expect(deps.router.chatWithTools).toHaveBeenCalledTimes(3)
    // The retry call must not offer the handoff tool — it forces a direct reply.
    expect((deps.router.chatWithTools as any).mock.calls[2][2]).toEqual([])
  })

  it('falls back to the general agent when the classifier picks an unknown domain', async () => {
    ;(deps.classifier.classify as any).mockResolvedValue({ domain: 'nonexistent', confidence: 0, classifiedBy: 'rules' })
    ;(deps.router.chatWithTools as any).mockResolvedValueOnce({ content: 'ok', toolCalls: [] })

    const trace = await runTeamChain(deps, 'anything')

    expect(trace[0].agentId).toBe('general')
  })

  it('offers no handoff tool once every other active agent has been visited or is self', async () => {
    // With only 4 agents in the mock registry, the visited-set cycle guard
    // exhausts available targets well before turnBudget (6) does — this
    // proves the "no valid targets left" path forces a direct reply, whichever
    // guard causes it.
    ;(deps.router.chatWithTools as any).mockImplementation((_model: string, _messages: unknown, tools: unknown[]) => {
      if (tools.length === 0) return Promise.resolve({ content: 'final answer, no more handoff available', toolCalls: [] })
      return Promise.resolve({
        content: 'handing off',
        toolCalls: [{ id: 'x', name: 'handoff', args: { targetAgentId: 'general', expectation: 'placeholder' } }],
      })
    })
    ;(deps.router.chat as any).mockResolvedValue({ reply: '{"satisfied": true, "note": "ok"}', decision: {} })

    const trace = await runTeamChain(deps, 'anything')

    expect(trace[trace.length - 1].reply).toBe('final answer, no more handoff available')
  })

  it('a note written during one task is recallable during a later, unrelated task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coastal-team-chain-'))
    const realStore = new NoteStore({ dataDir: dir })
    const realDeps = baseDeps({ noteStore: realStore })

    ;(realDeps.router.chatWithTools as any).mockResolvedValueOnce({
      content: 'the Q3 budget is 5000 dollars', toolCalls: [],
    })
    await runTeamChain(realDeps, 'what is the Q3 budget')

    const seenMessages: any[] = []
    ;(realDeps.router.chatWithTools as any).mockImplementationOnce((_model: string, messages: any[]) => {
      seenMessages.push(...messages)
      return Promise.resolve({ content: 'ok', toolCalls: [] })
    })
    await runTeamChain(realDeps, 'remind me about the Q3 budget')

    const recalledBlock = seenMessages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Relevant memory'))
    expect(recalledBlock?.content).toContain('5000')

    realStore.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
