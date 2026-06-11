import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

// Gate A: the folder-bundled sidecar (node runtime + deployed app/) starts and
// serves /api/version (i.e. the SQLite-backed stack came up) on an OS-assigned
// port, announcing it via the CC_SIDECAR_READY contract. Run after `bundle:sidecar`.
const buildDir = resolve(import.meta.dirname, '..', 'sidecar-build')
const appMain = resolve(buildDir, 'app', 'dist', 'main.js')
const runtime = existsSync(buildDir)
  ? readdirSync(buildDir).find((f) => f.startsWith('coastal-core-'))
  : undefined

describe('Gate A: folder-bundled coastal-core sidecar', () => {
  it('serves /api/version on an OS-assigned port', async () => {
    expect(runtime, 'run `pnpm --filter @coastal-ai/core bundle:sidecar` first').toBeTruthy()
    expect(existsSync(appMain), 'deployed app/dist/main.js missing').toBe(true)

    const proc = spawn(resolve(buildDir, runtime), [appMain], {
      env: { ...process.env, CC_PORT: '0', CC_HOST: '127.0.0.1' },
    })
    try {
      const port = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('no CC_SIDECAR_READY in 30s')), 30_000)
        proc.stdout.on('data', (b) => {
          const m = b.toString().match(/CC_SIDECAR_READY (\d+)/)
          if (m) {
            clearTimeout(t)
            res(Number(m[1]))
          }
        })
        proc.stderr.on('data', (b) => process.stderr.write(b))
        proc.on('exit', (code) => {
          clearTimeout(t)
          rej(new Error(`sidecar exited early with code ${code}`))
        })
      })
      expect(port).toBeGreaterThan(0)
      const r = await fetch(`http://127.0.0.1:${port}/api/version`)
      expect(r.status).toBe(200)
    } finally {
      proc.kill()
    }
  }, 45_000)
})
