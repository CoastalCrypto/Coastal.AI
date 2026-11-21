import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const payloadSchema = z.object({
  cycleId: z.string().min(1),
  gate: z.enum(['plan', 'diff', 'merge']),
  decision: z.enum(['approved', 'rejected', 'revised']),
  expiresAt: z.number(),
})

export type CallbackPayload = z.infer<typeof payloadSchema>

/**
 * Verifies a base64url-encoded, HMAC-SHA256-signed architect approval
 * callback token. Reimplements packages/architect/src/callback-signer.ts's
 * CallbackSigner.verify against the same wire format — core does not depend
 * on the architect package, so this checks the shared, persisted key
 * (getOrCreateCallbackKey) directly rather than importing that class.
 * Constant-time HMAC comparison and expiry + gate/decision enum validation,
 * replacing the shape-only stub this previously was.
 */
export function verifyCallbackToken(key: Buffer, token: string): CallbackPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { hmac, ...rest } = decoded
    if (typeof hmac !== 'string') return null

    const parsed = payloadSchema.safeParse(rest)
    if (!parsed.success) return null

    const expected = createHmac('sha256', key).update(JSON.stringify(rest)).digest('hex')
    const a = Buffer.from(hmac, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    if (Date.now() > parsed.data.expiresAt) return null
    return parsed.data
  } catch {
    return null
  }
}
