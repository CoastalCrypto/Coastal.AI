import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPeerRegistry } from '../peer-registry.js'

describe('peer-registry syncthing device ids', () => {
  it('stores, reads, and lists device ids', () => {
    const r = createPeerRegistry()
    r.setDeviceId('node-2', 'DEV-2')
    r.setDeviceId('node-9', 'DEV-9')
    expect(r.getDeviceId('node-2')).toBe('DEV-2')
    expect(r.getDeviceId('node-x')).toBeUndefined()
    expect(r.knownDeviceIds()).toEqual(new Set(['DEV-2', 'DEV-9']))
  })

  it('persists device ids across reload, preserving pubkeys', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'preg-')), 'peers.json')
    const r1 = createPeerRegistry({ persistencePath: path })
    r1.recordOrVerify('node-2', 'pubkey-2')
    r1.setDeviceId('node-2', 'DEV-2')
    await r1.flush()
    const r2 = createPeerRegistry({ persistencePath: path })
    expect(r2.getDeviceId('node-2')).toBe('DEV-2')
    expect(r2.get('node-2')).toBe('pubkey-2')
  })

  it('drops the device id when a peer is forgotten', () => {
    const r = createPeerRegistry()
    r.setDeviceId('node-2', 'DEV-2')
    r.forget('node-2')
    expect(r.getDeviceId('node-2')).toBeUndefined()
    expect(r.knownDeviceIds()).toEqual(new Set())
  })
})
