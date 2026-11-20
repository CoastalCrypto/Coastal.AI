import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolveLocalBin } from '../resolve-local-bin.js'

describe('resolveLocalBin', () => {
  it('resolves an installed package to an existing file path', () => {
    const path = resolveLocalBin('@modelcontextprotocol/server-sequential-thinking')
    expect(existsSync(path)).toBe(true)
  })

  it('resolves both default MCP server packages', () => {
    for (const pkg of ['@modelcontextprotocol/server-sequential-thinking', '@modelcontextprotocol/server-memory']) {
      const path = resolveLocalBin(pkg)
      expect(existsSync(path)).toBe(true)
    }
  })

  it('throws a clear error for a package that is not installed', () => {
    expect(() => resolveLocalBin('this-package-definitely-does-not-exist')).toThrow()
  })
})
