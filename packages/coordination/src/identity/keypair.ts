// packages/coordination/src/identity/keypair.ts
//
// Per-node Ed25519 keypair lifecycle: generate, persist, load.
//
// Key format on disk: SPKI-DER public key + PKCS8-DER private key, both
// base64-encoded inside a JSON blob. This is the universal interop
// format — Python (`cryptography`), Rust (`ring` / `ed25519-dalek`), and
// Go (`crypto/ed25519`) can all consume it. Critical for Phase 4+ when
// non-Node.js agents (e.g., a Kronos sidecar in Python) join the swarm.

import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from 'node:crypto'
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  chmodSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { AgentIdentity } from '../types.js'

/** In-memory cache so we don't re-import keys on every sign/verify call. */
const keyObjectCache = new WeakMap<object, { priv: KeyObject; pub: KeyObject }>()

/** Generate a fresh keypair for `agentId`. Side-effect free. */
export function generateIdentity(agentId: string): AgentIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  })
  return {
    agentId,
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64'),
  }
}

/**
 * Load an identity from disk; if the file doesn't exist, generate one
 * and persist it before returning. The common path for daemon startup.
 *
 * `path` is also chmod'd to 0600 on write — the private key never
 * leaves this process unencrypted in transit and is read-restricted at
 * rest.
 */
export function loadOrCreateIdentity(agentId: string, path: string): AgentIdentity {
  if (existsSync(path)) {
    const loaded = JSON.parse(readFileSync(path, 'utf8')) as AgentIdentity
    if (loaded.agentId !== agentId) {
      throw new Error(
        `loadOrCreateIdentity: identity at ${path} is for "${loaded.agentId}", ` +
        `but caller passed "${agentId}". Refusing to overwrite — delete the ` +
        `file manually if you really want to rekey.`,
      )
    }
    return loaded
  }
  const fresh = generateIdentity(agentId)
  persistIdentity(fresh, path)
  return fresh
}

export function persistIdentity(identity: AgentIdentity, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(identity, null, 2), 'utf8')
  // POSIX 0600 = owner read/write only. No-op on Windows; the file is
  // still in a per-user directory by convention. The OS image will run
  // on Linux where this matters.
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best-effort; Windows tests run fine without it.
  }
}

/**
 * Materialize the Node.js KeyObject pair for an identity, caching for
 * subsequent calls. Used by the envelope sign/verify path.
 */
export function keyObjectsFor(identity: AgentIdentity): { priv: KeyObject; pub: KeyObject } {
  const cached = keyObjectCache.get(identity)
  if (cached) return cached
  const priv = createPrivateKey({
    key: Buffer.from(identity.privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  const pub = createPublicKey({
    key: Buffer.from(identity.publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const pair = { priv, pub }
  keyObjectCache.set(identity, pair)
  return pair
}

/** Materialize a peer's public KeyObject from its base64 SPKI-DER form. */
export function publicKeyFromBase64(publicKeyBase64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyBase64, 'base64'),
    format: 'der',
    type: 'spki',
  })
}
