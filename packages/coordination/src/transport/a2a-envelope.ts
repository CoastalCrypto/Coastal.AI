// packages/coordination/src/transport/a2a-envelope.ts
//
// Sign and verify A2A wire envelopes. The signature scheme:
//
//   1. Strip the `signature` field (it's the output we're computing)
//   2. Canonicalize the remaining object — recursive lex-sorted keys,
//      no whitespace, JSON.stringify of leaves. RFC 8785-compatible
//      enough for cross-language interop with Python/Rust agents in
//      later phases (strict JCS for numbers can be layered in if a
//      non-JS peer fails to verify — flagged as a known limit).
//   3. Sign the UTF-8 bytes of that canonical string with Ed25519
//   4. Base64-encode the signature; that's the `signature` field
//
// Verification is the reverse, plus an optional pubkey-match check
// (TOFU-locked peer keys).

import { sign as edSign, verify as edVerify } from 'node:crypto'
import { ulid } from '@coastal-ai/core/architect/ulid'
import type {
  A2AMessage, A2AMessageKind, AgentIdentity,
} from '../types.js'
import { A2A_PROTOCOL_VERSION } from '../types.js'
import { keyObjectsFor, publicKeyFromBase64 } from '../identity/keypair.js'
import { createReplayGuard, type ReplayGuard } from './replay-guard.js'

/**
 * Deterministic JSON serialization with recursive lex-sorted object
 * keys and no whitespace. The output is what gets signed.
 *
 * Limitations vs. strict RFC 8785 (JCS):
 *   - Numbers use V8's default JSON.stringify (not IEEE-754-canonical).
 *     For non-JS peers, we'd want strict JCS or to limit numeric
 *     payloads to integers. Flagged in the handoff doc.
 *   - `undefined` values are silently dropped (matches JSON semantics).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`)
}

export interface BuildMessageInput {
  to: string | '*'
  kind: A2AMessageKind
  payload: unknown
  /** Override for tests; defaults to ulid(). */
  messageId?: string
  /** Override for tests; defaults to Date.now(). */
  timestamp?: number
}

/**
 * Build a signed A2A envelope. `identity` provides the from-agent ID,
 * declared public key, and signing key.
 */
export function signMessage(input: BuildMessageInput, identity: AgentIdentity): A2AMessage {
  const unsigned: Omit<A2AMessage, 'signature'> = {
    version: A2A_PROTOCOL_VERSION,
    messageId: input.messageId ?? ulid(),
    from: {
      agentId: identity.agentId,
      publicKey: identity.publicKey,
    },
    to: input.to,
    timestamp: input.timestamp ?? Date.now(),
    kind: input.kind,
    payload: input.payload,
  }
  const canonical = canonicalize(unsigned)
  const { priv } = keyObjectsFor(identity)
  // Ed25519 in Node.js uses `null` as the digest algorithm — the key
  // type itself dictates the scheme.
  const sigBuf = edSign(null, Buffer.from(canonical, 'utf8'), priv)
  return { ...unsigned, signature: sigBuf.toString('base64') }
}

export interface VerifyResult {
  valid: boolean
  /** Populated on `valid === false` with the failure reason. */
  reason?: string
}

export interface VerifyOpts {
  /**
   * Known public key for `msg.from.agentId`, if we've seen this agent
   * before (TOFU-locked). If supplied and it doesn't match
   * `msg.from.publicKey`, verification fails — even before the
   * signature is checked. This is the protection against an attacker
   * declaring someone else's agentId with their own pubkey.
   *
   * On first contact (no known key), pass undefined; the message is
   * verified against its declared key, and the caller is responsible
   * for TOFU-locking once they trust the contact.
   */
  knownPublicKey?: string
  /** Override for tests; defaults to Date.now. */
  now?: () => number
  /**
   * Replay-detection cache. Every production transport (tcp.ts,
   * localhost.ts, telegram.ts) creates its OWN guard once, at transport
   * construction, and passes it on every call — because replay tracking is
   * inherently scoped to "has this one receiver seen this messageId
   * before", and a broadcast delivers the same messageId to every
   * receiver. Falling back to the shared module-level default below is
   * only correct when exactly one logical receiver exists in the whole
   * process; a test harness or in-process multi-agent runner (like
   * swarm-demos) that simulates several peers in one process MUST pass a
   * guard per simulated peer, or peer B's legitimate receipt of a
   * broadcast gets rejected as "replayed" the moment peer C receives the
   * identical envelope — this exact bug was caught by this package's own
   * broadcast tests failing after the replay check was first added.
   */
  replayGuard?: ReplayGuard
}

/**
 * ±2 minutes. Wide enough to tolerate real clock drift between two nodes
 * that haven't NTP-synced perfectly; narrow enough that a captured envelope
 * is only ever replayable for a few minutes even before the replay-guard
 * cache (below) closes that window down to zero for a message actually
 * seen once.
 */
const CLOCK_SKEW_MS = 120_000

const defaultReplayGuard = createReplayGuard()

export function verifyMessage(msg: A2AMessage, opts: VerifyOpts = {}): VerifyResult {
  if (msg.version !== A2A_PROTOCOL_VERSION) {
    return { valid: false, reason: `unknown protocol version: ${msg.version}` }
  }
  if (opts.knownPublicKey && opts.knownPublicKey !== msg.from.publicKey) {
    return {
      valid: false,
      reason: `declared pubkey does not match known pubkey for agent ${msg.from.agentId}`,
    }
  }
  const { signature, ...unsigned } = msg
  if (!signature) return { valid: false, reason: 'missing signature' }
  let pubKey
  try {
    pubKey = publicKeyFromBase64(msg.from.publicKey)
  } catch (e) {
    return { valid: false, reason: `invalid pubkey encoding: ${(e as Error).message}` }
  }
  let valid: boolean
  try {
    valid = edVerify(
      null,
      Buffer.from(canonicalize(unsigned), 'utf8'),
      pubKey,
      Buffer.from(signature, 'base64'),
    )
  } catch (e) {
    return { valid: false, reason: `verify threw: ${(e as Error).message}` }
  }
  if (!valid) return { valid: false, reason: 'signature did not verify' }

  // Freshness and replay checks run only once the signature is confirmed
  // authentic — checking them first would let an attacker grief a
  // legitimate message's messageId with an unsigned decoy, since the decoy
  // would never reach this point to be "seen" if ordered the other way.
  const now = (opts.now ?? Date.now)()
  if (Math.abs(now - msg.timestamp) > CLOCK_SKEW_MS) {
    return { valid: false, reason: `timestamp outside the ${CLOCK_SKEW_MS}ms clock-skew window` }
  }
  const guard = opts.replayGuard ?? defaultReplayGuard
  if (!guard.check(msg.messageId, now)) {
    return { valid: false, reason: 'replayed message: messageId already seen' }
  }

  return { valid: true }
}
