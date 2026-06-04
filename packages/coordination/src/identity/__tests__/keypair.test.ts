// packages/coordination/src/identity/__tests__/keypair.test.ts

import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import {
  generateIdentity, loadOrCreateIdentity, persistIdentity, keyObjectsFor,
} from '../keypair.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'coord-keypair-test-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('keypair', () => {
  describe('generateIdentity', () => {
    it('produces a usable Ed25519 keypair', () => {
      const id = generateIdentity('agent-1')
      expect(id.agentId).toBe('agent-1')
      expect(id.publicKey.length).toBeGreaterThan(20)
      expect(id.privateKey.length).toBeGreaterThan(20)
      // Round-trip through KeyObject to confirm DER parses
      const { priv, pub } = keyObjectsFor(id)
      expect(priv.asymmetricKeyType).toBe('ed25519')
      expect(pub.asymmetricKeyType).toBe('ed25519')
    })

    it('produces distinct keys on each call', () => {
      const a = generateIdentity('agent-1')
      const b = generateIdentity('agent-1')
      expect(a.publicKey).not.toBe(b.publicKey)
      expect(a.privateKey).not.toBe(b.privateKey)
    })
  })

  describe('persist + load', () => {
    it('round-trips an identity through the filesystem', () => {
      withTempDir(dir => {
        const path = join(dir, 'identity.key')
        const original = generateIdentity('coder-1')
        persistIdentity(original, path)
        expect(existsSync(path)).toBe(true)
        const loaded = loadOrCreateIdentity('coder-1', path)
        expect(loaded).toEqual(original)
      })
    })

    it('generates on first call, loads on subsequent calls', () => {
      withTempDir(dir => {
        const path = join(dir, 'identity.key')
        const first = loadOrCreateIdentity('node-7', path)
        const second = loadOrCreateIdentity('node-7', path)
        expect(second).toEqual(first)
      })
    })

    it('refuses to load an identity that belongs to a different agent', () => {
      withTempDir(dir => {
        const path = join(dir, 'identity.key')
        const owner = generateIdentity('agent-A')
        persistIdentity(owner, path)
        expect(() => loadOrCreateIdentity('agent-B', path))
          .toThrow(/Refusing to overwrite/)
      })
    })
  })
})
