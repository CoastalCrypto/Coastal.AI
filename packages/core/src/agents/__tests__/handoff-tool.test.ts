import { describe, it, expect } from 'vitest'
import { HANDOFF_TOOL_NAME, buildHandoffToolSchema, parseHandoffCall } from '../handoff-tool.js'

describe('buildHandoffToolSchema', () => {
  it('builds a function schema whose targetAgentId enum matches the given targets', () => {
    const schema = buildHandoffToolSchema(['cfo', 'coo'])
    expect(schema.type).toBe('function')
    expect(schema.function.name).toBe(HANDOFF_TOOL_NAME)
    expect(schema.function.parameters.properties.targetAgentId.enum).toEqual(['cfo', 'coo'])
    expect(schema.function.parameters.required).toEqual(['targetAgentId', 'expectation'])
  })
})

describe('parseHandoffCall', () => {
  it('extracts targetAgentId and expectation from a matching tool call', () => {
    const call = parseHandoffCall([
      { id: '1', name: HANDOFF_TOOL_NAME, args: { targetAgentId: 'cfo', expectation: 'give a cost estimate' } },
    ])
    expect(call).toEqual({ targetAgentId: 'cfo', expectation: 'give a cost estimate' })
  })

  it('returns null when there is no handoff call', () => {
    expect(parseHandoffCall([{ id: '1', name: 'some_other_tool', args: {} }])).toBeNull()
    expect(parseHandoffCall([])).toBeNull()
  })

  it('returns null when the handoff call has missing or wrongly-typed args', () => {
    expect(parseHandoffCall([{ id: '1', name: HANDOFF_TOOL_NAME, args: { targetAgentId: 'cfo' } }])).toBeNull()
    expect(parseHandoffCall([{ id: '1', name: HANDOFF_TOOL_NAME, args: { targetAgentId: 5, expectation: 'x' } }])).toBeNull()
  })
})
