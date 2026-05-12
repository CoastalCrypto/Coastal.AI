import { describe, it, expect, vi } from 'vitest'
import { runBuildingStage } from '../building.js'

const baseDeps = {
  diff: '--- a/x.ts\n+++ b/x.ts\n@@\n+x\n',
  applyDiff: vi.fn(),
  runLint: vi.fn(),
  runTypecheck: vi.fn(),
  runBuild: vi.fn(),
  runTests: vi.fn(),
}

describe('runBuildingStage', () => {
  it('returns ok when all gates pass', async () => {
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTypecheck: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runBuild: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTests: vi.fn().mockResolvedValue({ ok: true, output: '4 passed' }),
    }
    const result = await runBuildingStage(deps as any)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.testSummary).toContain('4 passed')
  })

  it('stops at apply failure with kind=apply', async () => {
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockRejectedValue(new Error('hunk #1 failed')),
    }
    const result = await runBuildingStage(deps as any)
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('apply')
  })

  it('stops at lint failure with kind=lint', async () => {
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: false, output: 'eslint error: ...' }),
    }
    const result = await runBuildingStage(deps as any)
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('lint')
  })

  it('stops at type failure with kind=type', async () => {
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTypecheck: vi.fn().mockResolvedValue({ ok: false, output: 'TS2304: cannot find name foo' }),
    }
    const result = await runBuildingStage(deps as any)
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('type')
  })

  it('stops at build failure with kind=build', async () => {
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTypecheck: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runBuild: vi.fn().mockResolvedValue({ ok: false, output: 'build failed' }),
    }
    const result = await runBuildingStage(deps as any)
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('build')
  })

  it('stops at test failure with kind=test', async () => {
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTypecheck: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runBuild: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTests: vi.fn().mockResolvedValue({ ok: false, output: '1 failed' }),
    }
    const result = await runBuildingStage(deps as any)
    expect(result.kind).toBe('soft_fail')
    if (result.kind === 'soft_fail') expect(result.failureKind).toBe('test')
  })

  it('truncates failure output to 4000 chars in revise context', async () => {
    const longOutput = 'x'.repeat(10000)
    const deps = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: false, output: longOutput }),
    }
    const result = await runBuildingStage(deps as any)
    if (result.kind === 'soft_fail') {
      expect(result.message.length).toBeLessThanOrEqual(4000)
    }
  })

  describe('testStrictness', () => {
    const allGreenExceptTests = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTypecheck: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runBuild: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTests: vi.fn().mockResolvedValue({ ok: false, output: '3 failed' }),
    }

    it('defaults to must-pass when omitted (legacy callers unaffected)', async () => {
      const result = await runBuildingStage(allGreenExceptTests as any)
      expect(result.kind).toBe('soft_fail')
      if (result.kind === 'soft_fail') expect(result.failureKind).toBe('test')
    })

    it('must-pass: failing tests still soft_fail', async () => {
      const result = await runBuildingStage({ ...allGreenExceptTests, testStrictness: 'must-pass' } as any)
      expect(result.kind).toBe('soft_fail')
    })

    it('warn: failing tests return ok with [WARN] prefix in summary', async () => {
      const result = await runBuildingStage({ ...allGreenExceptTests, testStrictness: 'warn' } as any)
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') {
        expect(result.testSummary).toMatch(/^\[WARN\]/)
        expect(result.testSummary).toContain('3 failed')
      }
    })

    it('advisory: failing tests return ok with [ADVISORY] prefix in summary', async () => {
      const result = await runBuildingStage({ ...allGreenExceptTests, testStrictness: 'advisory' } as any)
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') {
        expect(result.testSummary).toMatch(/^\[ADVISORY\]/)
      }
    })

    it('must-pass / warn / advisory all preserve passing-tests behavior', async () => {
      const passingDeps = {
        ...baseDeps,
        applyDiff: vi.fn().mockResolvedValue(undefined),
        runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
        runTypecheck: vi.fn().mockResolvedValue({ ok: true, output: '' }),
        runBuild: vi.fn().mockResolvedValue({ ok: true, output: '' }),
        runTests: vi.fn().mockResolvedValue({ ok: true, output: '4 passed' }),
      }
      for (const s of ['must-pass', 'warn', 'advisory'] as const) {
        const result = await runBuildingStage({ ...passingDeps, testStrictness: s } as any)
        expect(result.kind).toBe('ok')
        if (result.kind === 'ok') {
          expect(result.testSummary).not.toMatch(/^\[/)
          expect(result.testSummary).toContain('4 passed')
        }
      }
    })
  })

  describe('eval gate (optional)', () => {
    const passingGates = {
      ...baseDeps,
      applyDiff: vi.fn().mockResolvedValue(undefined),
      runLint: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTypecheck: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runBuild: vi.fn().mockResolvedValue({ ok: true, output: '' }),
      runTests: vi.fn().mockResolvedValue({ ok: true, output: '4 passed' }),
    }

    it('skips the eval gate entirely when runEvals is omitted (legacy)', async () => {
      const result = await runBuildingStage(passingGates as any)
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') expect(result.testSummary).not.toContain('[evals]')
    })

    it('appends [evals] note to the testSummary on a passing eval gate', async () => {
      const runEvals = vi.fn().mockReturnValue({ ok: true, output: '3/3 fixtures passing' })
      const result = await runBuildingStage({ ...passingGates, runEvals } as any)
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') expect(result.testSummary).toContain('[evals] 3/3 fixtures passing')
    })

    it('soft_fails with kind=eval when the gate fails', async () => {
      const runEvals = vi.fn().mockReturnValue({ ok: false, output: '1/3 FAILING\n  - bad-fixture' })
      const result = await runBuildingStage({ ...passingGates, runEvals } as any)
      expect(result.kind).toBe('soft_fail')
      if (result.kind === 'soft_fail') {
        expect(result.failureKind).toBe('eval')
        expect(result.message).toContain('1/3 FAILING')
      }
    })

    it('does NOT run the eval gate when tests fail (no point evaluating broken builds)', async () => {
      const runEvals = vi.fn()
      await runBuildingStage({
        ...passingGates,
        runTests: vi.fn().mockResolvedValue({ ok: false, output: 'tests failed' }),
        runEvals,
      } as any)
      expect(runEvals).not.toHaveBeenCalled()
    })
  })
})
