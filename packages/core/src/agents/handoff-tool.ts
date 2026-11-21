import type { OllamaToolSchema } from './session.js'
import type { ToolCall } from './types.js'

export const HANDOFF_TOOL_NAME = 'handoff'

export interface HandoffCall {
  targetAgentId: string
  expectation: string
}

/**
 * targetAgentId is constrained to an enum built fresh each turn from
 * availableHandoffTargets — this makes an invalid-target handoff call
 * structurally impossible for the model to produce, not just rejected after
 * the fact.
 */
export function buildHandoffToolSchema(targets: string[]): OllamaToolSchema {
  return {
    type: 'function',
    function: {
      name: HANDOFF_TOOL_NAME,
      description:
        'Hand this task off to a specific teammate who genuinely needs to handle part of it. ' +
        'Only call this if you actually need another domain\'s expertise — otherwise just answer directly.',
      parameters: {
        type: 'object',
        properties: {
          targetAgentId: { type: 'string', description: 'The teammate to hand off to.', enum: targets },
          expectation: {
            type: 'string',
            description: 'A specific, checkable statement of what you need them to deliver — not a vague reason.',
          },
        },
        required: ['targetAgentId', 'expectation'],
      },
    },
  }
}

export function parseHandoffCall(toolCalls: ToolCall[]): HandoffCall | null {
  const call = toolCalls.find(tc => tc.name === HANDOFF_TOOL_NAME)
  if (!call) return null
  const { targetAgentId, expectation } = call.args
  if (typeof targetAgentId !== 'string' || typeof expectation !== 'string') return null
  return { targetAgentId, expectation }
}
