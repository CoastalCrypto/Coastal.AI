// packages/llm-client/src/compressing-client.ts
//
// LlmClient decorator that compresses the compressible parts of a request's
// messages before delegating to the wrapped client. The real compression is
// performed by the headroom-ai TS SDK, which is a CLIENT to a per-node headroom
// proxy (default http://127.0.0.1:8787) — `fallback: true` degrades to a
// passthrough when the proxy is unreachable, so this decorator is a safe no-op
// until the proxy sidecar is provisioned.
//
// Policy: protect `system` and sub-`minChars` messages verbatim; compress the
// rest per-message; keep the original whenever the "compressed" form is not
// strictly smaller; fail open on any error. Telemetry (token counts) is
// surfaced via onStats.

import type { LlmClient, ChatMessage, ChatStreamChunk } from './types.js'

export interface CompressOutcome {
  /** Compressed messages — same shape/order/count as the input. */
  messages: ChatMessage[]
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  compressed: boolean
}

export type CompressFn = (
  messages: ChatMessage[],
  opts: { model: string },
) => Promise<CompressOutcome>

export interface CompressionStat {
  model: string
  messagesCompressed: number
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
}

export interface CompressOpts {
  /** Defaults to the headroom-ai-backed compressor. */
  compress?: CompressFn
  /** Messages shorter than this are passed through untouched. Default 500. */
  minChars?: number
  /** Best-effort telemetry sink; errors are swallowed. */
  onStats?: (s: CompressionStat) => void
}

const DEFAULT_MIN_CHARS = 500
const HEADROOM_BASE_URL = process.env.COASTAL_HEADROOM_URL ?? 'http://127.0.0.1:8787'

/** Default compressor: wraps headroom-ai's `compress` against the local proxy. */
const defaultCompress: CompressFn = async (messages, { model }) => {
  const { compress } = await import('headroom-ai')
  const res = await compress(messages as unknown[], {
    model,
    baseUrl: HEADROOM_BASE_URL,
    fallback: true,
  })
  return {
    messages: (res.messages as ChatMessage[]).map((m) => ({ role: m.role, content: m.content })),
    tokensBefore: res.tokensBefore ?? 0,
    tokensAfter: res.tokensAfter ?? 0,
    tokensSaved: res.tokensSaved ?? 0,
    compressed: Boolean(res.compressed),
  }
}

function isEligible(m: ChatMessage, minChars: number): boolean {
  return m.role !== 'system' && m.content.length >= minChars
}

/**
 * Wrap an LlmClient so request messages are compressed before the call. Agents
 * are unaware — the decorator satisfies the same LlmClient interface.
 */
export function createCompressingLlmClient(inner: LlmClient, opts: CompressOpts = {}): LlmClient {
  const minChars = opts.minChars ?? DEFAULT_MIN_CHARS
  const compress = opts.compress ?? defaultCompress
  const onStats = opts.onStats

  async function compressMessages(model: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    let messagesCompressed = 0
    let tokensBefore = 0
    let tokensAfter = 0
    let tokensSaved = 0
    let eligibleCount = 0
    const out: ChatMessage[] = []

    for (const m of messages) {
      if (!isEligible(m, minChars)) {
        out.push(m)
        continue
      }
      eligibleCount++
      try {
        const oc = await compress([m], { model })
        const candidate = oc.messages[0]
        if (oc.compressed && candidate && candidate.content.length < m.content.length) {
          out.push(candidate)
          messagesCompressed++
          tokensBefore += oc.tokensBefore
          tokensAfter += oc.tokensAfter
          tokensSaved += oc.tokensSaved
        } else {
          out.push(m)
        }
      } catch (err) {
        // Fail open: a failed compression must never break or bloat the call.
        out.push(m)
        console.warn(`[compress] failed; using original message: ${(err as Error).message}`)
      }
    }

    if (onStats && eligibleCount > 0) {
      try {
        onStats({ model, messagesCompressed, tokensBefore, tokensAfter, tokensSaved })
      } catch {
        // Telemetry must not touch the agent path.
      }
    }
    return out
  }

  return {
    async chat(req) {
      const messages = await compressMessages(req.model, req.messages)
      return inner.chat({ ...req, messages })
    },
    chatStream(req) {
      async function* gen(): AsyncGenerator<ChatStreamChunk> {
        const messages = await compressMessages(req.model, req.messages)
        yield* inner.chatStream({ ...req, messages })
      }
      return gen()
    },
  }
}
