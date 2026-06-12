import { describe, it, expect, afterEach, vi } from 'vitest'
import { coreHttpOrigin, coreWsOrigin } from './coreOrigin'

const g = globalThis as { __COASTAL_CORE_PORT__?: string | number }

afterEach(() => {
  delete g.__COASTAL_CORE_PORT__
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('coreOrigin', () => {
  it('defaults to the legacy 4747 origin when nothing is injected', () => {
    expect(coreHttpOrigin()).toBe('http://127.0.0.1:4747')
    expect(coreWsOrigin()).toBe('ws://127.0.0.1:4747')
  })

  it('prefers the Tauri-injected global port', () => {
    g.__COASTAL_CORE_PORT__ = 53187
    expect(coreHttpOrigin()).toBe('http://127.0.0.1:53187')
    expect(coreWsOrigin()).toBe('ws://127.0.0.1:53187')
  })

  it('falls back to the ?corePort query param', () => {
    vi.stubGlobal('location', { search: '?corePort=61000' } as Location)
    expect(coreHttpOrigin()).toBe('http://127.0.0.1:61000')
  })

  it('uses VITE_CORE_API_URL when set and no port is injected', () => {
    vi.stubEnv('VITE_CORE_API_URL', 'http://127.0.0.1:9999')
    expect(coreHttpOrigin()).toBe('http://127.0.0.1:9999')
  })

  it('injected port beats the env URL', () => {
    vi.stubEnv('VITE_CORE_API_URL', 'http://127.0.0.1:9999')
    g.__COASTAL_CORE_PORT__ = 42
    expect(coreHttpOrigin()).toBe('http://127.0.0.1:42')
  })
})
