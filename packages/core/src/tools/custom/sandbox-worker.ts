// packages/core/src/tools/custom/sandbox-worker.ts
//
// Entry point for a custom tool's actual execution. process-sandbox.ts
// spawns this file as a *separate Node process* with --permission denying
// filesystem, child_process, worker_threads and native-addon access
// outright — a real, OS-enforced boundary, unlike the in-process vm.Script
// this replaces (Node's own docs are explicit: vm must not be used to run
// untrusted code as a security mechanism — context escapes via the
// constructor/prototype chain are a known class, not a hypothetical one).
//
// Scope, stated honestly rather than implied: this blocks fs read/write,
// spawning child processes, worker_threads, and native addons. It does NOT
// block outbound network — fetch is still available, and Node's permission
// model has no network control as of this writing — nor does it stop a
// sufficiently adversarial script from reaching the *true* global scope via
// indirect eval (`(0, eval)('process')`) or the Function constructor,
// which is a fundamental limit of sandboxing inside a single JS realm: both
// resolve in the real global environment, bypassing any closure/parameter
// shadowing. The parameter-shadowing below stops accidental or
// unsophisticated access to process/require/fetch; it is not the security
// boundary and must not be read as one. What actually holds is: (1) the OS
// process boundary with fs/child_process/worker/addons denied, and (2) an
// emptied environment at spawn time (process-sandbox.ts), so there is no
// application secret to read even via a successful eval-based escape — see
// that file's header for the one platform caveat (Windows env can't be
// suppressed to a literal empty object, only to a baseline with no
// secrets in it).

process.stdin.setEncoding('utf8')
let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  run().catch((e) => {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message ?? e) }))
    process.exitCode = 1
  })
})

async function run() {
  const { implBody, argsJson } = JSON.parse(input)
  const args = JSON.parse(argsJson)

  let out = ''
  const sandboxConsole = {
    log: (...a: unknown[]) => { out += a.map(String).join(' ') + '\n' },
    error: (...a: unknown[]) => { out += '[error] ' + a.map(String).join(' ') + '\n' },
  }

  // Shadowed identifiers: a bare reference to any of these names inside
  // implBody resolves to undefined rather than the real binding. Does not
  // stop eval-based escapes — see the file header.
  const fn = new Function(
    'globalThis', 'global', 'process', 'require', 'module', 'exports',
    'fetch', 'WebSocket', 'XMLHttpRequest',
    'args', 'console',
    `return (async function(args) {\n${implBody}\n})(args)`,
  )

  try {
    const result = await fn(
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      args, sandboxConsole,
    )
    if (result !== undefined) out += (out.length > 0 ? '\n' : '') + String(result)
    process.stdout.write(JSON.stringify({ ok: true, result: out.trim() }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out += (out.length > 0 ? '\n' : '') + '[error] ' + msg
    // Ran, but the tool's own code threw — this is a successful sandbox
    // execution that happens to report an error, not a sandbox failure.
    process.stdout.write(JSON.stringify({ ok: true, result: out.trim() }))
  }
}
