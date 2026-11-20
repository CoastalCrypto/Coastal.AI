// packages/core/src/tools/mcp/resolve-local-bin.ts
//
// Resolves an installed npm package's CLI entry point to an absolute file
// path, so a default MCP server can be launched with `node <path>` instead
// of `npx <package>@<version>` — npx resolves a version-pinned specifier
// against the public registry on every launch unless an exact match is
// already in its local cache, which means every server start (not just
// first boot) reaches out to npm for @modelcontextprotocol/server-memory
// and @modelcontextprotocol/server-sequential-thinking, contradicting the
// "entirely local, no data leaving your machine" claim this product leads
// with. Depending on the package directly (package.json) and resolving its
// own declared bin path makes the exact pinned version a build-time
// dependency instead of a runtime network call.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface PackageJsonBinFields {
  bin?: string | Record<string, string>
}

/**
 * Resolves `packageName`'s CLI entry point to an absolute path, using the
 * package's own package.json#bin field rather than a hardcoded relative
 * path — so this keeps working if the package restructures its dist
 * layout, same as `npx` would transparently handle.
 */
export function resolveLocalBin(packageName: string): string {
  const require = createRequire(import.meta.url)
  const pkgJsonPath = require.resolve(`${packageName}/package.json`)
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJsonBinFields

  const binRel = typeof pkgJson.bin === 'string'
    ? pkgJson.bin
    : Object.values(pkgJson.bin ?? {})[0]

  if (!binRel) {
    throw new Error(`resolveLocalBin: ${packageName}'s package.json declares no "bin" entry`)
  }

  return join(dirname(pkgJsonPath), binRel)
}
