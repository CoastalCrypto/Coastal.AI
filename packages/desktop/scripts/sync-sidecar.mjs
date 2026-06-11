// Copies the folder-bundled sidecar (runtime binary + deployed app/) from
// packages/core/sidecar-build into this package's src-tauri tree so Tauri can
// find the externalBin runtime (binaries/) and the app resources (resources/).
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcBuild = resolve(here, '..', '..', 'core', 'sidecar-build')
const binDir = resolve(here, '..', 'src-tauri', 'binaries')
const resDir = resolve(here, '..', 'src-tauri', 'resources')

if (!existsSync(srcBuild)) {
  throw new Error('packages/core/sidecar-build missing — run `pnpm --filter @coastal-ai/core bundle:sidecar` first')
}

// 1. Copy the renamed node runtime(s) (coastal-core-<triple>[.exe]).
mkdirSync(binDir, { recursive: true })
const runtimes = readdirSync(srcBuild).filter((f) => f.startsWith('coastal-core-'))
if (runtimes.length === 0) throw new Error('no coastal-core-<triple> runtime in sidecar-build')
for (const f of runtimes) cpSync(resolve(srcBuild, f), resolve(binDir, f))

// 2. Copy the self-contained app/ (dist + node_modules) into resources/app.
rmSync(resolve(resDir, 'app'), { recursive: true, force: true })
mkdirSync(resDir, { recursive: true })
cpSync(resolve(srcBuild, 'app'), resolve(resDir, 'app'), { recursive: true })

console.log('[sync-sidecar] staged', runtimes.join(', '), '+ app/ into src-tauri/')
