import type { NodeRole, DaemonConfig } from '@coastal-ai/coordination'

type Worker = DaemonConfig['worker']

/**
 * Map a role to its worker. Unwired roles get a passthrough that records the
 * task kind as the result — keeps the daemon loop honest until each role's
 * LLM-backed agent (coding-agent, reviewing-agent, …) is imported and wired
 * here. This module is the single place allowed to import role-agent packages,
 * keeping the Turbo build graph acyclic (coordination must not depend on them).
 */
const passthrough: Worker = async (task) => ({ noopFor: task.kind })

export function workerFor(_role: NodeRole): Worker {
  return passthrough
}
