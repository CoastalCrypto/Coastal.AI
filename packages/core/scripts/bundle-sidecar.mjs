// Builds the `coastal-core` sidecar for the Tauri desktop shell (folder-bundle).
//
//   node scripts/bundle-sidecar.mjs
//
// Produces, under packages/core/sidecar-build/:
//   app/                          self-contained: dist/ + package.json + node_modules
//   coastal-core-<triple>[.exe]   a copy of the node runtime (Tauri externalBin)
//
// Why npm, not pnpm deploy: core's stack has many native addons (better-sqlite3,
// onnxruntime-node, nodejs-polars) and the MCP SDK with TRANSITIVE deps. pnpm's
// deploy output is a `.pnpm` JUNCTION tree — node resolution depends on those
// junctions, so it is neither flat nor portable: copying/dereferencing it breaks
// transitive resolution (e.g. zod-to-json-schema) and a naive recursive copy
// follows a workspace self-junction until the disk fills. `npm install --omit=dev`
// produces a FLAT, real, junction-free node_modules that node resolves natively
// and that copies trivially to a user's machine.
import { mkdirSync, rmSync, existsSync, copyFileSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'sidecar-build')
const appDir = resolve(outDir, 'app')
const isWin = process.platform === 'win32'

function targetTriple() {
  const a = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (isWin) return `${a}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${a}-apple-darwin`
  return `${a}-unknown-linux-gnu`
}

// 1. Assemble a standalone app dir (dist + package.json) and install prod deps
// flat with npm.
function buildApp() {
  if (!existsSync(resolve(root, 'dist', 'main.js'))) {
    throw new Error('dist/main.js missing — run `pnpm --filter @coastal-ai/core build` first')
  }
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(appDir, { recursive: true })
  cpSync(resolve(root, 'dist'), resolve(appDir, 'dist'), { recursive: true })

  // Strip workspace/dev fields from package.json so npm installs cleanly.
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const appPkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: pkg.type,
    main: 'dist/main.js',
    dependencies: pkg.dependencies ?? {},
  }
  writeFileSync(resolve(appDir, 'package.json'), JSON.stringify(appPkg, null, 2))

  // --legacy-peer-deps: core resolves a known peer conflict (mem0ai wants
  // better-sqlite3@^12, core pins @11) the same way pnpm does — tolerate it.
  // The app runs fine on @11 (Gate A). Strict npm peer resolution would reject it.
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--legacy-peer-deps'], {
    stdio: 'inherit',
    cwd: appDir,
    shell: isWin,
  })

  for (const f of ['dist/main.js', 'node_modules/better-sqlite3/package.json', 'node_modules/zod-to-json-schema/package.json']) {
    if (!existsSync(resolve(appDir, f))) {
      throw new Error(`flat install incomplete — missing ${f}`)
    }
  }
}

// 2. Ship a copy of the node runtime as the Tauri externalBin.
function copyRuntime() {
  const ext = isWin ? '.exe' : ''
  const binPath = resolve(outDir, `coastal-core-${targetTriple()}${ext}`)
  copyFileSync(process.execPath, binPath)
  console.log('[bundle] runtime ->', binPath)
}

buildApp()
copyRuntime()
console.log('[bundle] flat folder-bundle ready in', outDir)
