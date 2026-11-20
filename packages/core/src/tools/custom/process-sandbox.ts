// packages/core/src/tools/custom/process-sandbox.ts
//
// Spawns sandbox-worker.ts (compiled: sandbox-worker.js, sitting next to
// this file in dist/) as a separate Node process to actually run a custom
// tool's implBody — see that file's header for exactly what boundary this
// does and does not provide. This module owns the two controls that live
// on the parent side of that boundary: an emptied environment, so there is
// nothing application-specific for the child to read even via an eval-based
// escape (on Windows, libuv's spawn backfills a small fixed set of
// OS-required variables — HOMEDRIVE, PATH, SYSTEMROOT, USERNAME, etc. —
// that env:{} can't suppress, confirmed experimentally; POSIX hosts get a
// genuinely empty env either way, and neither platform's baseline includes
// application secrets, which only reach process.env via explicit
// assignment), and a wall-clock timeout that kills the child outright
// rather than trusting it to exit on its own.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = join(__dirname, 'sandbox-worker.js')

// Generous for a tool's text output, bounded against a runaway script
// filling memory with console.log calls.
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024

interface SandboxResult {
  ok: boolean
  result?: string
  error?: string
}

/**
 * Runs implBody against args in the sandboxed child process, returning the
 * tool's output text. Never rejects — a sandbox-level failure (spawn error,
 * timeout, bad output) is reported as a "[tool error] ..." string in the
 * same shape a tool's own thrown error would be, matching the previous
 * vm-based behavior that callers (ToolRegistry, the /api/admin/tools/test
 * route) already depend on.
 */
export function runInSandbox(implBody: string, args: Record<string, unknown>, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--permission', `--allow-fs-read=${WORKER_PATH}`, WORKER_PATH],
      { stdio: ['pipe', 'pipe', 'pipe'], env: {} },
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve(`[tool error] execution timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8')
    })

    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(`[tool error] ${e.message}`)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Try the JSON payload first regardless of exit code — a malformed
      // implBody throws synchronously inside sandbox-worker.ts's run(),
      // which still writes a well-formed {ok:false, error} to stdout before
      // the process exits non-zero. Falling through to "exited with code
      // N" in that case would discard a perfectly good error message.
      try {
        const parsed = JSON.parse(stdout) as SandboxResult
        if (!parsed.ok) {
          resolve(`[tool error] ${parsed.error ?? 'unknown sandbox error'}`)
          return
        }
        resolve(parsed.result || '(no output)')
        return
      } catch {
        // stdout wasn't a parseable result at all — fall back to whatever
        // diagnostic the process gave us.
      }
      if (code !== 0) {
        resolve(`[tool error] sandbox process exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`)
        return
      }
      resolve('[tool error] sandbox produced invalid output')
    })

    child.stdin.write(JSON.stringify({ implBody, argsJson: JSON.stringify(args || {}) }))
    child.stdin.end()
  })
}
