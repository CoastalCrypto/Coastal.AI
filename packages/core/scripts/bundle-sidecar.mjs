// Builds the `coastal-core` sidecar for the Tauri desktop shell using the
// folder-bundle strategy (the Phase-1 spike rejected single-binary Node SEA:
// core's native-addon surface — better-sqlite3, onnxruntime-node, nodejs-polars,
// bufferutil/utf-8-validate — plus puppeteer cannot be embedded).
//
//   node scripts/bundle-sidecar.mjs
//
// Produces, under packages/core/sidecar-build/:
//   app/                          self-contained deploy: dist/ + real node_modules
//   coastal-core-<triple>[.exe]   a copy of the node runtime (Tauri externalBin)
//
// Tauri ships `app/` as a resource and spawns the runtime against app/dist/main.js.
import { mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(root, '..', '..')
const outDir = resolve(root, 'sidecar-build')
const appDir = resolve(outDir, 'app')
const isWin = process.platform === 'win32'

function targetTriple() {
  const a = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (isWin) return `${a}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${a}-apple-darwin`
  return `${a}-unknown-linux-gnu`
}

// 1. Self-contained deploy of core (dist + de-symlinked production node_modules).
function deployApp() {
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  execFileSync(
    'pnpm',
    ['--filter=@coastal-ai/core', 'deploy', '--prod', '--legacy', appDir],
    { stdio: 'inherit', cwd: workspaceRoot, shell: isWin },
  )
  if (!existsSync(resolve(appDir, 'dist', 'main.js'))) {
    throw new Error('deploy produced no dist/main.js — run `pnpm --filter @coastal-ai/core build` first')
  }
  if (!existsSync(resolve(appDir, 'node_modules', 'better-sqlite3'))) {
    throw new Error('deploy produced no better-sqlite3 in node_modules')
  }
}

// 2. Ship a copy of the node runtime as the Tauri externalBin.
function copyRuntime() {
  const ext = isWin ? '.exe' : ''
  const binPath = resolve(outDir, `coastal-core-${targetTriple()}${ext}`)
  copyFileSync(process.execPath, binPath)
  console.log('[bundle] runtime ->', binPath)
}

deployApp()
copyRuntime()
console.log('[bundle] folder-bundle ready in', outDir)
