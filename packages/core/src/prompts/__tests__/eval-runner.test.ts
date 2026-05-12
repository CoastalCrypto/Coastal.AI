import { describe, it, expect, vi } from 'vitest'
import {
  runEval, runEvalSuite, renderEvalResultMarkdown,
  type LLM, type Fixture, type Assertion,
} from '../eval-runner.js'
import type { PromptDefinition } from '../registry.js'

const samplePrompt: PromptDefinition<{ name: string }> = {
  id: 'greet',
  version: 1,
  description: 'simple greeting',
  expectedVars: ['name'],
  render: (v) => `Say hi to ${v.name}.`,
}

function fixture(
  id: string, vars: { name: string }, assertions: readonly Assertion[],
): Fixture<{ name: string }> {
  return { id, label: id, vars, assertions }
}

describe('runEval', () => {
  it('passes when every assertion succeeds', async () => {
    const llm: LLM = async () => 'Hello, Coastal!'
    const r = await runEval(samplePrompt, fixture('basic', { name: 'Coastal' }, [
      { kind: 'contains', value: 'Hello' },
      { kind: 'contains', value: 'Coastal' },
      { kind: 'minLength', value: 5 },
    ]), llm)
    expect(r.ok).toBe(true)
    expect(r.assertions.every(a => a.passed)).toBe(true)
  })

  it('fails when any assertion misses, with detail on the failure', async () => {
    const llm: LLM = async () => 'oops'
    const r = await runEval(samplePrompt, fixture('miss', { name: 'X' }, [
      { kind: 'contains', value: 'Hello' },
    ]), llm)
    expect(r.ok).toBe(false)
    expect(r.assertions[0].detail).toContain('contain "Hello"')
  })

  it('records LLM errors as a failed result rather than throwing', async () => {
    const llm: LLM = async () => { throw new Error('connection refused') }
    const r = await runEval(samplePrompt, fixture('llm-fail', { name: 'X' }, [
      { kind: 'contains', value: 'anything' },
    ]), llm)
    expect(r.ok).toBe(false)
    expect(r.assertions[0].detail).toContain('connection refused')
    expect(r.responseLength).toBe(0)
  })

  it('truncates the response preview but reports full length', async () => {
    const big = 'a'.repeat(2000)
    const llm: LLM = async () => big
    const r = await runEval(samplePrompt, fixture('big', { name: 'X' }, []), llm)
    expect(r.responseLength).toBe(2000)
    expect(r.responsePreview.length).toBeLessThan(2000)
  })

  it('records the model id when supplied via opts', async () => {
    const llm: LLM = async () => 'ok'
    const r = await runEval(samplePrompt, fixture('m', { name: 'X' }, []), llm, { model: 'ollama:llama3.2' })
    expect(r.model).toBe('ollama:llama3.2')
  })

  it('passes the rendered prompt (not the raw template) to the LLM', async () => {
    const llm = vi.fn().mockResolvedValue('ok')
    await runEval(samplePrompt, fixture('m', { name: 'Coastal' }, []), llm)
    expect(llm.mock.calls[0][0]).toBe('Say hi to Coastal.')
  })
})

describe('Assertion variants', () => {
  it('contains with not:true passes when the substring is absent', async () => {
    const llm: LLM = async () => 'something else'
    const r = await runEval(samplePrompt, fixture('not-contains', { name: 'X' }, [
      { kind: 'contains', value: 'Hello', not: true },
    ]), llm)
    expect(r.ok).toBe(true)
  })

  it('matches succeeds with a valid regex', async () => {
    const llm: LLM = async () => 'PASS-123'
    const r = await runEval(samplePrompt, fixture('regex', { name: 'X' }, [
      { kind: 'matches', pattern: '^PASS-\\d+$' },
    ]), llm)
    expect(r.ok).toBe(true)
  })

  it('matches with flags is case-insensitive', async () => {
    const llm: LLM = async () => 'YES we can'
    const r = await runEval(samplePrompt, fixture('regex-i', { name: 'X' }, [
      { kind: 'matches', pattern: 'yes', flags: 'i' },
    ]), llm)
    expect(r.ok).toBe(true)
  })

  it('matches with not:true passes when the regex does not match', async () => {
    const llm: LLM = async () => 'no'
    const r = await runEval(samplePrompt, fixture('regex-not', { name: 'X' }, [
      { kind: 'matches', pattern: '^yes$', not: true },
    ]), llm)
    expect(r.ok).toBe(true)
  })

  it('matches reports invalid regexes as a failure (not throw)', async () => {
    const llm: LLM = async () => 'ok'
    const r = await runEval(samplePrompt, fixture('bad-regex', { name: 'X' }, [
      { kind: 'matches', pattern: '[' },
    ]), llm)
    expect(r.ok).toBe(false)
    expect(r.assertions[0].detail).toContain('invalid regex')
  })

  it('minLength fails when the response is too short', async () => {
    const llm: LLM = async () => 'hi'
    const r = await runEval(samplePrompt, fixture('min', { name: 'X' }, [
      { kind: 'minLength', value: 100 },
    ]), llm)
    expect(r.ok).toBe(false)
  })

  it('maxLength fails when the response is too long', async () => {
    const llm: LLM = async () => 'a'.repeat(50)
    const r = await runEval(samplePrompt, fixture('max', { name: 'X' }, [
      { kind: 'maxLength', value: 10 },
    ]), llm)
    expect(r.ok).toBe(false)
  })
})

describe('runEvalSuite', () => {
  it('runs every fixture sequentially and returns one result each', async () => {
    const llm: LLM = async (p) => p.includes('Coastal') ? 'Hello, Coastal!' : 'goodbye'
    const results = await runEvalSuite(samplePrompt, [
      fixture('a', { name: 'Coastal' }, [{ kind: 'contains', value: 'Hello' }]),
      fixture('b', { name: 'Other' }, [{ kind: 'contains', value: 'Hello' }]),
    ], llm)
    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
  })
})

describe('renderEvalResultMarkdown', () => {
  it('produces a markdown block with the result, assertions, and response preview', async () => {
    const llm: LLM = async () => 'Hello world'
    const r = await runEval(samplePrompt, fixture('md', { name: 'X' }, [
      { kind: 'contains', value: 'Hello' },
      { kind: 'contains', value: 'missing' },
    ]), llm)
    const md = renderEvalResultMarkdown(r)
    expect(md).toContain('# greet@1 · md')
    expect(md).toContain('FAIL ✗')
    expect(md).toContain('✓ contains "Hello"')
    expect(md).toContain('✗ contains "missing"')
    expect(md).toContain('## Response (preview)')
    expect(md).toContain('Hello world')
  })
})
