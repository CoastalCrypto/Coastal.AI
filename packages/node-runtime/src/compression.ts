import type { OpenObserveClient, NodeRole } from '@coastal-ai/coordination'
import {
  createCompressingLlmClient,
  type LlmClient,
  type CompressionStat,
} from '@coastal-ai/llm-client'

export const COMPRESSION_STREAM = 'compression'

/** Per-role compression policy, read from node config at the composition root. */
export interface CompressionConfig {
  enabled: boolean
  disabledRoles: NodeRole[]
}

/**
 * Build an `onStats` sink that ingests one compression row per call into the
 * openobserve `compression` stream. Fire-and-forget + error-swallowing:
 * telemetry must never touch the agent path.
 */
export function createCompressionStatsSink(
  client: OpenObserveClient,
  nodeId: string,
  role: string,
  now: () => number = Date.now,
): (s: CompressionStat) => void {
  return (s) => {
    void client
      .ingest(COMPRESSION_STREAM, [{
        nodeId,
        role,
        model: s.model,
        messagesCompressed: s.messagesCompressed,
        tokensBefore: s.tokensBefore,
        tokensAfter: s.tokensAfter,
        tokensSaved: s.tokensSaved,
        ts: now(),
      }])
      .catch(() => { /* best-effort */ })
  }
}

/**
 * Wrap a role's LlmClient with compression unless it is disabled globally or for
 * this role. The decorator stays pure; the OS decides who gets it here.
 */
export function wrapClientForRole(
  inner: LlmClient,
  role: NodeRole,
  cfg: CompressionConfig,
  onStats?: (s: CompressionStat) => void,
): LlmClient {
  if (!cfg.enabled || cfg.disabledRoles.includes(role)) return inner
  return createCompressingLlmClient(inner, { onStats })
}
