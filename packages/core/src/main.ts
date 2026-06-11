// Server entry point — starts the HTTP server.
// Do NOT import this from library consumers (daemon, tests, etc.)
// Library exports live in lib.ts.
import { config as loadEnv } from 'dotenv'
import { resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load packages/core/.env.local (dev) or the file next to main.js (prod dist)
const __dir = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dir, '..', '.env.local'), override: false })
loadEnv({ path: resolve(__dir, '..', '..', '..', 'packages', 'core', '.env.local'), override: false })

// Anchor CC_DATA_DIR to packages/core/ so it's CWD-independent.
// Without this, a relative path resolves against whatever directory the
// process was started from — different shells produce different data dirs.
if (process.env.CC_DATA_DIR && !isAbsolute(process.env.CC_DATA_DIR)) {
  process.env.CC_DATA_DIR = resolve(__dir, '..', process.env.CC_DATA_DIR)
} else if (!process.env.CC_DATA_DIR) {
  process.env.CC_DATA_DIR = resolve(__dir, '..', 'data')
}

import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig()
const server = await buildServer()

await server.listen({ port: config.port, host: config.host })

// Resolve the actually-bound port (config.port may be 0 = OS-assigned).
const addr = server.server.address()
const boundPort = typeof addr === 'object' && addr ? addr.port : config.port
// Parseable readiness marker for the Tauri sidecar supervisor — emitted on
// stdout once Fastify is listening so the shell knows when to load the UI.
console.log(`CC_SIDECAR_READY ${boundPort}`)
console.log(`[coastal-ai] core running on ${config.host}:${boundPort}`)
