import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

// These tests spawn the real compiled sandbox-worker.js, not a mock — the
// whole point of this module is the OS-level boundary a mock can't exercise,
// and process-sandbox.ts locates its worker relative to *its own compiled*
// location (dist/tools/custom/sandbox-worker.js — see that file's header),
// which only exists post-build. vitest transforms and runs this test's `.ts`
// straight from src, so importing process-sandbox.ts directly here would
// resolve import.meta.url to src/, not dist/, and the worker wouldn't be
// found. Importing the actual compiled module instead (same convention
// main.startup.test.ts uses for the sidecar it spawns) exercises exactly
// what production runs. Requires `pnpm --filter @coastal-ai/core build` to
// have run first — true in CI, since turbo's test task depends on build.
let runInSandbox: (implBody: string, args: Record<string, unknown>, timeoutMs: number) => Promise<string>

beforeAll(async () => {
  const testDir = dirname(fileURLToPath(import.meta.url))
  const distPath = resolve(testDir, '..', '..', '..', '..', 'dist', 'tools', 'custom', 'process-sandbox.js')
  const mod = await import(pathToFileURL(distPath).href)
  runInSandbox = mod.runInSandbox
})

describe('runInSandbox', () => {
  it('runs a simple tool and returns its result', async () => {
    const out = await runInSandbox('return args.a + args.b', { a: 2, b: 3 }, 5000)
    expect(out).toBe('5')
  })

  it('captures console.log output', async () => {
    // The blank line between the logged line and the return value is
    // inherited unchanged from the vm-based implementation this replaces —
    // not a behavior this fix introduces or should silently change.
    const out = await runInSandbox("console.log('hi'); return 'done'", {}, 5000)
    expect(out).toBe('hi\n\ndone')
  })

  it("reports the tool's own thrown error without failing the sandbox", async () => {
    const out = await runInSandbox("throw new Error('boom')", {}, 5000)
    expect(out).toContain('[error]')
    expect(out).toContain('boom')
  })

  it('cannot read the filesystem', async () => {
    const out = await runInSandbox(
      "const fs = require('node:fs'); return fs.readFileSync('/etc/hostname', 'utf8')",
      {}, 5000,
    )
    expect(out).toContain('[error]')
  })

  it('cannot spawn a child process', async () => {
    const out = await runInSandbox(
      "const cp = require('node:child_process'); return cp.execSync('echo pwned').toString()",
      {}, 5000,
    )
    expect(out).toContain('[error]')
  })

  it('cannot spawn a worker thread', async () => {
    const out = await runInSandbox(
      "const { Worker } = require('node:worker_threads'); new Worker('1'); return 'spawned'",
      {}, 5000,
    )
    expect(out).toContain('[error]')
  })

  it('a bare `process` reference is shadowed to undefined', async () => {
    const out = await runInSandbox('return JSON.stringify(process.env)', {}, 5000)
    expect(out).toContain('[error]')
  })

  it('no application secret is reachable, even via indirect eval, which bypasses the shadow', async () => {
    // (0, eval)(...) is an *indirect* eval call — per spec it always runs
    // in the real global scope, not the enclosing closure's, so it reaches
    // the true `process` regardless of the shadowed parameter named
    // `process` in scope here. This is exactly the escape sandbox-worker.ts's
    // header warns about: the shadow doesn't stop it. What stops it is
    // process-sandbox.ts spawning with env:{} — so even a script that
    // successfully reaches the real process object finds nothing to steal.
    //
    // The assertion is "no secret-shaped key survives", not "the object is
    // literally {}": on Windows, libuv's spawn backfills a small fixed set
    // of OS-required variables (HOMEDRIVE, PATH, SYSTEMROOT, USERNAME, …)
    // that can't be suppressed even with env:{} — confirmed experimentally
    // on this platform — but those never include application secrets
    // (API keys, tokens), which only ever reach process.env via explicit
    // assignment, never as part of that Windows baseline. POSIX hosts get
    // a genuinely empty env.
    const out = await runInSandbox("return (0, eval)('JSON.stringify(process.env)')", {}, 5000)
    const env = JSON.parse(out) as Record<string, string>
    const secretShaped = Object.keys(env).filter((k) => /API[_-]?KEY|TOKEN|SECRET|PASSWORD/i.test(k))
    expect(secretShaped).toEqual([])
  })

  it('is killed and reported on timeout rather than hanging', async () => {
    const start = Date.now()
    const out = await runInSandbox('while (true) {}', {}, 300)
    const elapsed = Date.now() - start
    expect(out).toContain('timed out')
    // Should resolve close to the timeout, not hang for the test's default timeout.
    expect(elapsed).toBeLessThan(3000)
  })

  it('returns a tool-error string for malformed implBody rather than throwing', async () => {
    // A syntax error happens at Function-construction time, before the
    // try/catch around *running* the tool even starts — sandbox-worker.ts's
    // top-level .catch classifies this as [tool error] (couldn't run at
    // all), the same bucket as a timeout, distinct from [error] (ran, the
    // tool's own code threw).
    const out = await runInSandbox('this is not valid javascript {{{', {}, 5000)
    expect(out).toContain('[tool error]')
  })
})
