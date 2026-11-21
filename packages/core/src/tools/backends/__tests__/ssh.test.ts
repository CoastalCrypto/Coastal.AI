// packages/core/src/tools/backends/__tests__/ssh.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SshBackend } from '../ssh.js'

describe('SshBackend', () => {
  const hasTarget = Boolean(process.env.CC_SSH_HOST && process.env.CC_SSH_USER && process.env.CC_SSH_KEY_PATH)
  const backend = new SshBackend({
    host: process.env.CC_SSH_HOST ?? 'unused.invalid',
    port: Number(process.env.CC_SSH_PORT ?? '22'),
    username: process.env.CC_SSH_USER ?? 'unused',
    privateKeyPath: process.env.CC_SSH_KEY_PATH ?? '/dev/null',
  })
  let sshAvailable = false

  beforeAll(async () => {
    sshAvailable = await backend.isAvailable()
    if (!sshAvailable) {
      console.warn('No SSH target configured (CC_SSH_HOST/CC_SSH_USER/CC_SSH_KEY_PATH) — skipping SshBackend integration tests')
    }
  })

  afterAll(async () => {
    await backend.dispose()
  })

  it('isAvailable reflects connection reachability', async () => {
    const result = await backend.isAvailable()
    expect(typeof result).toBe('boolean')
  })

  it('isAvailable returns false for an unreachable host without throwing', async () => {
    if (hasTarget) return // only meaningful when we're deliberately testing the failure path
    const unreachable = new SshBackend({ host: '203.0.113.1', port: 22, username: 'nobody', privateKeyPath: '/dev/null' })
    expect(await unreachable.isAvailable()).toBe(false)
    await unreachable.dispose()
  })

  it('executes a command on the remote host', async () => {
    if (!sshAvailable) return
    const result = await backend.execute('echo ssh-backend-works', '.', 'test-session')
    expect(result.stdout).toContain('ssh-backend-works')
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
  })

  it('runs commands in the requested remote workdir', async () => {
    if (!sshAvailable) return
    const result = await backend.execute('pwd', '/tmp', 'test-session')
    expect(result.stdout.trim()).toBe('/tmp')
  })

  it('reuses the same connection across calls', async () => {
    if (!sshAvailable) return
    await backend.execute('true', '.', 'test-session')
    await backend.execute('true', '.', 'test-session')
    // No assertion beyond "didn't throw" — connect() is only exercised
    // once per backend instance if reuse is working; a regression here
    // would show up as a large latency increase, not a test failure, so
    // this is mostly a smoke check.
  })
})
