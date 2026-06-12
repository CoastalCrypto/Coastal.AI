// Copies the folder-bundled sidecar (runtime binary + deployed app/) from
// packages/core/sidecar-build into this package's src-tauri tree so Tauri can
// find the externalBin runtime (binaries/) and the app resources (resources/).
//
// The deployed app/ is a pnpm `.pnpm` tree whose internal package links are
// Windows JUNCTIONS. We dereference them into real files so resources/app is a
// portable, junction-free tree (also required for Tauri's bundler). Two safety
// rails prevent the disk-filling loop we hit before:
//   1. Skip any symlink/junction whose real target escapes the source root
//      (e.g. a stray workspace self-reference pointing at the live package).
//   2. Track the ancestor path stack to break any directory cycle.
import {
  cpSync, mkdirSync, readdirSync, rmSync, existsSync, lstatSync, realpathSync, copyFileSync,
} from 'node:fs'
import { resolve, dirname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcBuild = resolve(here, '..', '..', 'core', 'sidecar-build')
const binDir = resolve(here, '..', 'src-tauri', 'binaries')
const resDir = resolve(here, '..', 'src-tauri', 'resources')

if (!existsSync(srcBuild)) {
  throw new Error('packages/core/sidecar-build missing — run `pnpm --filter @coastal-ai/core bundle:sidecar` first')
}

// Dereferencing, cycle-safe recursive copy. `rootReal` bounds what we follow.
function copyReal(src, dst, rootReal, stack) {
  let st
  try {
    st = lstatSync(src)
  } catch {
    return // vanished mid-walk
  }

  if (st.isSymbolicLink()) {
    let target
    try {
      target = realpathSync(src)
    } catch {
      return // dangling link
    }
    const rel = relative(rootReal, target)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return // target escapes the source tree → skip (self-reference guard)
    }
    return copyReal(target, dst, rootReal, stack)
  }

  if (st.isDirectory()) {
    let canon
    try {
      canon = realpathSync(src)
    } catch {
      canon = src
    }
    if (stack.includes(canon)) return // ancestor cycle → stop
    stack.push(canon)
    mkdirSync(dst, { recursive: true })
    for (const name of readdirSync(src)) {
      copyReal(join(src, name), join(dst, name), rootReal, stack)
    }
    stack.pop()
    return
  }

  copyFileSync(src, dst)
}

// 1. Copy the renamed node runtime(s) (coastal-core-<triple>[.exe]).
mkdirSync(binDir, { recursive: true })
const runtimes = readdirSync(srcBuild).filter((f) => f.startsWith('coastal-core-'))
if (runtimes.length === 0) throw new Error('no coastal-core-<triple> runtime in sidecar-build')
for (const f of runtimes) cpSync(resolve(srcBuild, f), resolve(binDir, f))

// 2. Dereference the self-contained app/ into resources/app as real files.
const appSrc = resolve(srcBuild, 'app')
const appReal = realpathSync(appSrc)
rmSync(resolve(resDir, 'app'), { recursive: true, force: true })
mkdirSync(resDir, { recursive: true })
copyReal(appSrc, resolve(resDir, 'app'), appReal, [])

console.log('[sync-sidecar] staged', runtimes.join(', '), '+ dereferenced app/ into src-tauri/resources/')
