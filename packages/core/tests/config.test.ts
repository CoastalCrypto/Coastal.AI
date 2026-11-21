import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, invalidateConfig } from '../src/config.js'

describe('loadConfig', () => {
  let originalPort: string | undefined

  beforeEach(() => {
    originalPort = process.env.CC_PORT
    invalidateConfig()
  })

  afterEach(() => {
    if (originalPort === undefined) delete process.env.CC_PORT
    else process.env.CC_PORT = originalPort
    invalidateConfig()
  })

  it('returns default port 4747', () => {
    delete process.env.CC_PORT
    const config = loadConfig()
    expect(config.port).toBe(4747)
  })

  it('returns default host 127.0.0.1', () => {
    const config = loadConfig()
    expect(config.host).toBe('127.0.0.1')
  })

  it('overrides port from environment', () => {
    process.env.CC_PORT = '9000'
    const config = loadConfig()
    expect(config.port).toBe(9000)
  })

  it('throws on invalid CC_PORT', () => {
    process.env.CC_PORT = 'abc'
    expect(() => loadConfig()).toThrow('CC_PORT must be a valid port number')
  })
})

describe('loadConfig — remote trust level', () => {
  const keys = ['CC_TRUST_LEVEL', 'CC_SSH_HOST', 'CC_SSH_PORT', 'CC_SSH_USER', 'CC_SSH_KEY_PATH'] as const
  const original: Partial<Record<typeof keys[number], string>> = {}

  beforeEach(() => {
    for (const k of keys) original[k] = process.env[k]
    invalidateConfig()
  })

  afterEach(() => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    invalidateConfig()
  })

  it('throws when remote is selected without CC_SSH_* set', () => {
    process.env.CC_TRUST_LEVEL = 'remote'
    delete process.env.CC_SSH_HOST
    delete process.env.CC_SSH_USER
    delete process.env.CC_SSH_KEY_PATH
    expect(() => loadConfig()).toThrow("Trust level 'remote' requires")
  })

  it('accepts remote when all CC_SSH_* fields are set', () => {
    process.env.CC_TRUST_LEVEL = 'remote'
    process.env.CC_SSH_HOST = 'example.internal'
    process.env.CC_SSH_USER = 'coastal'
    process.env.CC_SSH_KEY_PATH = '/home/coastal/.ssh/id_ed25519'
    const config = loadConfig()
    expect(config.agentTrustLevel).toBe('remote')
    expect(config.sshHost).toBe('example.internal')
    expect(config.sshPort).toBe(22)
    expect(config.sshUser).toBe('coastal')
    expect(config.sshKeyPath).toBe('/home/coastal/.ssh/id_ed25519')
  })

  it('respects CC_SSH_PORT when set', () => {
    process.env.CC_TRUST_LEVEL = 'remote'
    process.env.CC_SSH_HOST = 'example.internal'
    process.env.CC_SSH_USER = 'coastal'
    process.env.CC_SSH_KEY_PATH = '/home/coastal/.ssh/id_ed25519'
    process.env.CC_SSH_PORT = '2222'
    expect(loadConfig().sshPort).toBe(2222)
  })
})
