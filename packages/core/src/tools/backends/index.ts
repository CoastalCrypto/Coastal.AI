// packages/core/src/tools/backends/index.ts
export type { ShellBackend, ShellResult } from './types.js'
export { NativeBackend } from './native.js'
export { RestrictedLocalBackend } from './restricted-local.js'
export { DockerBackend } from './docker.js'
export { NamespaceBackend } from './namespace.js'
export { SshBackend } from './ssh.js'
export type { SshBackendOptions } from './ssh.js'

import type { ShellBackend } from './types.js'
import type { TrustLevel } from '../../config.js'
import { NativeBackend } from './native.js'
import { RestrictedLocalBackend } from './restricted-local.js'
import { DockerBackend } from './docker.js'
import { NamespaceBackend } from './namespace.js'
import { SshBackend, type SshBackendOptions } from './ssh.js'

/**
 * Returns the best ShellBackend for the given trust level.
 * At 'sandboxed' tier: prefers NamespaceBackend on Linux, falls back to DockerBackend.
 * Now async because NamespaceBackend.isAvailable() checks the kernel.
 */
export async function createBackend(
  trustLevel: TrustLevel,
  allowedPaths: string[],
  sshOptions?: SshBackendOptions,
): Promise<ShellBackend> {
  if (trustLevel === 'sandboxed') {
    const ns = new NamespaceBackend()
    if (await ns.isAvailable()) return ns
    return new DockerBackend()
  }
  if (trustLevel === 'trusted') return new RestrictedLocalBackend(allowedPaths)
  if (trustLevel === 'remote') {
    // Guaranteed present by config.ts's load-time validation when
    // agentTrustLevel resolves to 'remote' — see loadConfig().
    return new SshBackend(sshOptions!)
  }
  return new NativeBackend()
}
