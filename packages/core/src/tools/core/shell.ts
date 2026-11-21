// packages/core/src/tools/core/shell.ts
import { resolve } from 'node:path'
import type { CoreTool } from './file.js'
import type { ShellBackend } from '../backends/types.js'
import { NativeBackend } from '../backends/native.js'

export function createShellTools(backend: ShellBackend, agentWorkdir: string): CoreTool[] {
  return [
    {
      definition: {
        name: 'run_command',
        description:
          'Execute a shell command in the agent workspace directory. Returns stdout + stderr.',
        parameters: {
          type: 'object',
          properties: {
            cmd:     { type: 'string', description: 'Shell command to run' },
            workdir: { type: 'string', description: 'Working directory (must be within agent workdir)' },
          },
          required: ['cmd'],
        },
        reversible: false,
      },
      execute: async (args) => {
        // SshBackend's workdir is a path on the *remote* host — resolve()/
        // startsWith() against the local agentWorkdir is meaningless there,
        // so it's passed through verbatim instead of locally containment-
        // checked. 'remote' is already a full-access tier (no local sandbox
        // either), so this isn't a containment regression.
        let requestedCwd: string
        if (backend.name === 'ssh') {
          requestedCwd = String(args.workdir ?? '.')
        } else {
          const rootWorkdir = resolve(agentWorkdir)
          requestedCwd = resolve(String(args.workdir ?? rootWorkdir))
          if (!requestedCwd.startsWith(rootWorkdir)) {
            return `Error: cwd escape attempt blocked. Requested: ${requestedCwd}, allowed: ${rootWorkdir}`
          }
        }

        const available = await backend.isAvailable()
        if (!available) {
          const hint = backend.name === 'docker'
            ? ' Ensure Docker Desktop is running (or set CC_TRUST_LEVEL=trusted).'
            : backend.name === 'ssh'
            ? ' Check CC_SSH_HOST/CC_SSH_USER/CC_SSH_KEY_PATH and that the remote host is reachable.'
            : ''
          return `Error: shell backend '${backend.name}' is not available.${hint}`
        }

        const result = await backend.execute(
          String(args.cmd),
          requestedCwd,
          String(args.sessionId ?? 'default'),
        )
        return result.stdout || '(no output)'
      },
    },
  ]
}

// Backward-compat export for existing direct usages in tests
export const shellTools = createShellTools(new NativeBackend(), process.cwd())
