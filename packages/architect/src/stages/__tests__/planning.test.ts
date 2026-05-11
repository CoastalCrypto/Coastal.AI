// packages/architect/src/stages/__tests__/planning.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runPlanningStage } from '../planning.js'

const mockClient = {
  callPlan: vi.fn(),
}

describe('runPlanningStage', () => {
  it('extracts plan + diff blocks from a well-formed model response', async () => {
    mockClient.callPlan.mockResolvedValue({
      text: `<plan>
Wrap http_get in retry.
</plan>
<diff>
\`\`\`diff
--- a/web.ts
+++ b/web.ts
@@
-old
+new
\`\`\`
</diff>`,
      modelId: 'vllm:test',
    })
    const result = await runPlanningStage({
      workItem: { id: 'w1', title: 't', body: 'b', targetHints: ['web.ts'], budgetLoc: 200, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => 'old\nfile content\n',
      client: mockClient as any,
      lockedPathCheck: () => null, // path is OK
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.plan).toContain('Wrap http_get')
      expect(result.diff).toContain('+++ b/web.ts')
      expect(result.modelUsed).toBe('vllm:test')
    }
  })

  it('returns failure_kind=parse on missing diff block', async () => {
    mockClient.callPlan.mockResolvedValue({ text: '<plan>just a plan</plan>', modelId: 'm' })
    const result = await runPlanningStage({
      workItem: { id: 'w', title: 't', body: '', targetHints: [], budgetLoc: 200, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: mockClient as any,
      lockedPathCheck: () => null,
    })
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('parse')
  })

  it('returns failure_kind=locked when diff touches a locked path', async () => {
    mockClient.callPlan.mockResolvedValue({
      text: `<plan>p</plan><diff>\`\`\`diff
--- a/data/secrets.json
+++ b/data/secrets.json
@@\n+x\n\`\`\`</diff>`,
      modelId: 'm',
    })
    const result = await runPlanningStage({
      workItem: { id: 'w', title: 't', body: '', targetHints: [], budgetLoc: 200, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: mockClient as any,
      lockedPathCheck: (p: string) => (p.startsWith('data/') ? `locked: ${p}` : null),
    })
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') {
      expect(result.failureKind).toBe('locked')
      expect(result.message).toContain('data/secrets.json')
    }
  })

  it('returns failure_kind=budget when diff exceeds budget_loc', async () => {
    const bigDiff = '+\n'.repeat(300) // 300 added lines
    mockClient.callPlan.mockResolvedValue({
      text: `<plan>p</plan><diff>\`\`\`diff
--- a/x.ts
+++ b/x.ts
@@
${bigDiff}\`\`\`</diff>`,
      modelId: 'm',
    })
    const result = await runPlanningStage({
      workItem: { id: 'w', title: 't', body: '', targetHints: [], budgetLoc: 100, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: mockClient as any,
      lockedPathCheck: () => null,
    })
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('budget')
  })

  it('returns hard_fail on LLM error', async () => {
    mockClient.callPlan.mockRejectedValue(new Error('connection refused'))
    const result = await runPlanningStage({
      workItem: { id: 'w', title: 't', body: '', targetHints: [], budgetLoc: 100, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: mockClient as any,
      lockedPathCheck: () => null,
    })
    expect(result.kind).toBe('hard_fail')
    if (result.kind === 'hard_fail') expect(result.failureKind).toBe('env_llm')
  })

  it('injects impactSummary into the prompt when provided', async () => {
    const callPlan = vi.fn().mockResolvedValue({
      text: `<plan>p</plan><diff>\`\`\`diff\n--- a/x.ts\n+++ b/x.ts\n@@\n+x\n\`\`\`</diff>`,
      modelId: 'm',
    })
    await runPlanningStage({
      workItem: { id: 'w', title: 't', body: '', targetHints: ['x.ts'], budgetLoc: 100, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: { callPlan } as any,
      lockedPathCheck: () => null,
      impactSummary: '### IMPACT: x.ts\nImported by (3): a.ts, b.ts, c.ts',
    })
    const promptArg = callPlan.mock.calls[0][0] as string
    expect(promptArg).toContain('IMPACT RADIUS')
    expect(promptArg).toContain('Imported by (3): a.ts, b.ts, c.ts')
  })

  it("does NOT inject impactSummary when null/empty (backwards compatible)", async () => {
    const callPlan = vi.fn().mockResolvedValue({
      text: `<plan>p</plan><diff>\`\`\`diff\n--- a/x.ts\n+++ b/x.ts\n@@\n+x\n\`\`\`</diff>`,
      modelId: 'm',
    })
    await runPlanningStage({
      workItem: { id: 'w', title: 't', body: '', targetHints: ['x.ts'], budgetLoc: 100, allowSelfModify: false } as any,
      reviseContext: null,
      readSourceFile: async () => '',
      client: { callPlan } as any,
      lockedPathCheck: () => null,
      impactSummary: '',
    })
    expect(callPlan.mock.calls[0][0]).not.toContain('IMPACT RADIUS')
  })
})
