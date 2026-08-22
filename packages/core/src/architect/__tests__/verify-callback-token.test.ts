import { describe, it, expect } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { verifyCallbackToken } from '../verify-callback-token.js'

// Mirrors CallbackSigner.sign (packages/architect/src/callback-signer.ts) so
// these tests exercise the real wire format without a cross-package import.
function sign(key: Buffer, payload: { cycleId: string; gate: string; decision: string; expiresAt: number }): string {
  const data = JSON.stringify(payload)
  const hmac = createHmac('sha256', key).update(data).digest('hex')
  return Buffer.from(JSON.stringify({ ...payload, hmac })).toString('base64url')
}

describe('verifyCallbackToken', () => {
  const key = randomBytes(32)
  const validPayload = { cycleId: 'cycle-123', gate: 'plan', decision: 'approved', expiresAt: Date.now() + 60_000 }

  it('accepts a validly signed, unexpired token', () => {
    const token = sign(key, validPayload)
    expect(verifyCallbackToken(key, token)).toEqual(validPayload)
  })

  it('rejects a token signed with a different key', () => {
    const wrongKey = randomBytes(32)
    const token = sign(wrongKey, validPayload)
    expect(verifyCallbackToken(key, token)).toBeNull()
  })

  it('rejects a tampered token (decision flipped after signing)', () => {
    const token = sign(key, validPayload)
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString())
    decoded.decision = 'rejected' // flip without re-signing
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    expect(verifyCallbackToken(key, tampered)).toBeNull()
  })

  it('rejects an expired token even if the signature is valid', () => {
    const expired = { ...validPayload, expiresAt: Date.now() - 1000 }
    const token = sign(key, expired)
    expect(verifyCallbackToken(key, token)).toBeNull()
  })

  it('rejects a gate value outside the canonical enum', () => {
    const token = sign(key, { ...validPayload, gate: 'merge-now' })
    expect(verifyCallbackToken(key, token)).toBeNull()
  })

  it('rejects a decision value outside the canonical enum', () => {
    const token = sign(key, { ...validPayload, decision: 'maybe' })
    expect(verifyCallbackToken(key, token)).toBeNull()
  })

  it('rejects malformed base64url/JSON without throwing', () => {
    expect(verifyCallbackToken(key, 'not-valid-base64url!!!')).toBeNull()
  })

  it('rejects a shape-only forged token with no hmac field (the old stub would have accepted this)', () => {
    const forged = Buffer.from(JSON.stringify(validPayload)).toString('base64url')
    expect(verifyCallbackToken(key, forged)).toBeNull()
  })
})
