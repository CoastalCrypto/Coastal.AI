import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Verifies the sidecar startup contract: with CC_PORT=0 the core binds an
// OS-assigned port and announces it on stdout as `CC_SIDECAR_READY <port>`,
// which the Tauri sidecar supervisor parses to know when to load the UI.
describe('core sidecar startup contract', () => {
  it('binds an OS-assigned port with CC_PORT=0 and prints CC_SIDECAR_READY <port>', async () => {
    const main = resolve(import.meta.dirname, '..', 'dist', 'main.js')
    const proc = spawn(process.execPath, [main], {
      env: { ...process.env, CC_PORT: '0', CC_HOST: '127.0.0.1' },
    })
    try {
      const port: number = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('no CC_SIDECAR_READY in 20s')), 20_000)
        proc.stdout.on('data', (b: Buffer) => {
          const m = b.toString().match(/CC_SIDECAR_READY (\d+)/)
          if (m) {
            clearTimeout(t)
            res(Number(m[1]))
          }
        })
        proc.stderr.on('data', (b: Buffer) => process.stderr.write(b))
        proc.on('exit', (code) => {
          clearTimeout(t)
          rej(new Error(`core exited early with code ${code}`))
        })
      })
      expect(port).toBeGreaterThan(0)
      const r = await fetch(`http://127.0.0.1:${port}/api/version`)
      expect(r.status).toBe(200)
    } finally {
      proc.kill()
    }
  }, 30_000)
})
