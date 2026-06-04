// packages/coordination/src/identity/__tests__/peer-registry.test.ts

import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createPeerRegistry } from '../peer-registry.js'

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'coord-peer-reg-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('PeerRegistry — in-memory', () => {
  it('records a new peer on first contact (firstContact=true)', () => {
    const reg = createPeerRegistry()
    const r = reg.recordOrVerify('agent-A', 'PUBKEY-A')
    expect(r.trusted).toBe(true)
    expect(r.firstContact).toBe(true)
    expect(reg.get('agent-A')).toBe('PUBKEY-A')
  })

  it('returns trusted=true on subsequent calls with same key', () => {
    const reg = createPeerRegistry()
    reg.recordOrVerify('agent-A', 'PUBKEY-A')
    const r = reg.recordOrVerify('agent-A', 'PUBKEY-A')
    expect(r.trusted).toBe(true)
    expect(r.firstContact).toBe(false)
  })

  it('returns trusted=false when a known peer presents a different key', () => {
    const reg = createPeerRegistry()
    reg.recordOrVerify('agent-A', 'PUBKEY-A')
    const r = reg.recordOrVerify('agent-A', 'IMPOSTER-KEY')
    expect(r.trusted).toBe(false)
    expect(r.reason).toMatch(/mismatch/)
    expect(reg.get('agent-A')).toBe('PUBKEY-A') // original key unchanged
  })

  it('forget() removes a peer', () => {
    const reg = createPeerRegistry()
    reg.recordOrVerify('agent-A', 'PUBKEY-A')
    reg.forget('agent-A')
    expect(reg.get('agent-A')).toBeUndefined()
    // Next contact is a fresh TOFU
    const r = reg.recordOrVerify('agent-A', 'NEW-KEY')
    expect(r.firstContact).toBe(true)
  })

  it('list() returns sorted agent IDs', () => {
    const reg = createPeerRegistry()
    reg.recordOrVerify('c', 'PK-C')
    reg.recordOrVerify('a', 'PK-A')
    reg.recordOrVerify('b', 'PK-B')
    expect(reg.list()).toEqual(['a', 'b', 'c'])
  })
})

describe('PeerRegistry — persistent', () => {
  it('writes to disk on first TOFU contact', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'peers.json')
      const reg = createPeerRegistry({ persistencePath: path })
      reg.recordOrVerify('agent-A', 'PUBKEY-A')
      await reg.flush()
      expect(existsSync(path)).toBe(true)
      const data = JSON.parse(readFileSync(path, 'utf8'))
      expect(data.schema).toBe('coastal-peer-registry/v1')
      expect(data.peers['agent-A']).toBe('PUBKEY-A')
    })
  })

  it('loads existing peers from disk on creation', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'peers.json')
      const reg1 = createPeerRegistry({ persistencePath: path })
      reg1.recordOrVerify('agent-A', 'PUBKEY-A')
      reg1.recordOrVerify('agent-B', 'PUBKEY-B')
      await reg1.flush()

      const reg2 = createPeerRegistry({ persistencePath: path })
      expect(reg2.get('agent-A')).toBe('PUBKEY-A')
      expect(reg2.get('agent-B')).toBe('PUBKEY-B')
      // Re-verifying with the loaded key is NOT a first contact
      const r = reg2.recordOrVerify('agent-A', 'PUBKEY-A')
      expect(r.firstContact).toBe(false)
      expect(r.trusted).toBe(true)
    })
  })

  it('preserves locked keys across reload — impersonation rejected', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'peers.json')
      const reg1 = createPeerRegistry({ persistencePath: path })
      reg1.recordOrVerify('agent-A', 'REAL-A')
      await reg1.flush()

      const reg2 = createPeerRegistry({ persistencePath: path })
      const r = reg2.recordOrVerify('agent-A', 'IMPOSTER-A')
      expect(r.trusted).toBe(false)
    })
  })

  it('starts fresh when the file is corrupt (does not refuse to boot)', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'peers.json')
      // Write garbage
      writeFileSync(path, 'this is not JSON', 'utf8')
      const reg = createPeerRegistry({ persistencePath: path })
      expect(reg.list()).toEqual([])
      // Can still TOFU a new peer
      const r = reg.recordOrVerify('agent-A', 'PK-A')
      expect(r.firstContact).toBe(true)
    })
  })
})
