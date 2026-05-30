// packages/coordination/src/transport/__tests__/a2a-envelope.test.ts

import { describe, it, expect } from 'vitest'
import { generateIdentity } from '../../identity/keypair.js'
import {
  canonicalize, signMessage, verifyMessage,
} from '../a2a-envelope.js'

describe('canonicalize', () => {
  it('sorts object keys lexicographically and recursively', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalize({ z: { y: 1, x: 2 }, a: 1 })).toBe('{"a":1,"z":{"x":2,"y":1}}')
  })

  it('emits no whitespace', () => {
    const s = canonicalize({ a: [1, 2, { b: 'c' }] })
    expect(s).not.toMatch(/\s/)
    expect(s).toBe('{"a":[1,2,{"b":"c"}]}')
  })

  it('drops undefined fields silently (matches JSON)', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ x: NaN })).toThrow(/non-finite/)
    expect(() => canonicalize({ x: Infinity })).toThrow(/non-finite/)
  })

  it('is order-independent for object input', () => {
    const a = canonicalize({ x: 1, y: 2, z: 3 })
    const b = canonicalize({ z: 3, y: 2, x: 1 })
    expect(a).toBe(b)
  })
})

describe('signMessage + verifyMessage', () => {
  it('round-trips a signed message', () => {
    const id = generateIdentity('agent-A')
    const signed = signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: { role: 'coder' } },
      id,
    )
    const result = verifyMessage(signed)
    expect(result.valid).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const id = generateIdentity('agent-A')
    const signed = signMessage(
      { to: 'agent-B', kind: 'task.claim', payload: { taskId: 'task-1' } },
      id,
    )
    // Mutate the payload after signing
    const tampered = { ...signed, payload: { taskId: 'task-EVIL' } }
    const result = verifyMessage(tampered)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/signature/)
  })

  it('rejects a tampered envelope field (kind, to, timestamp)', () => {
    const id = generateIdentity('agent-A')
    const signed = signMessage(
      { to: 'agent-B', kind: 'task.heartbeat', payload: null },
      id,
    )
    expect(verifyMessage({ ...signed, kind: 'task.cancel' }).valid).toBe(false)
    expect(verifyMessage({ ...signed, to: 'agent-C' }).valid).toBe(false)
    expect(verifyMessage({ ...signed, timestamp: signed.timestamp + 1 }).valid).toBe(false)
  })

  it('rejects when declared pubkey does not match the known pubkey (TOFU lock)', () => {
    const realA = generateIdentity('agent-A')
    const imposter = generateIdentity('agent-A')
    const signed = signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: null },
      imposter,
    )
    // Caller knows the REAL agent-A's pubkey; the imposter declares their own.
    const result = verifyMessage(signed, { knownPublicKey: realA.publicKey })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/declared pubkey/)
  })

  it('accepts a message that signs with its declared pubkey when no TOFU lock is set', () => {
    const id = generateIdentity('first-contact-agent')
    const signed = signMessage(
      { to: '*', kind: 'agent.hello', payload: null },
      id,
    )
    expect(verifyMessage(signed).valid).toBe(true)
  })

  it('rejects unknown protocol version', () => {
    const id = generateIdentity('agent-A')
    const signed = signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: null },
      id,
    )
    const futured = { ...signed, version: '99.0' as '0.1' }
    expect(verifyMessage(futured).valid).toBe(false)
  })

  it('rejects missing signature', () => {
    const id = generateIdentity('agent-A')
    const signed = signMessage(
      { to: 'agent-B', kind: 'agent.hello', payload: null },
      id,
    )
    const stripped = { ...signed, signature: '' }
    expect(verifyMessage(stripped).valid).toBe(false)
  })
})
