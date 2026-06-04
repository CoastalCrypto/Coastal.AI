// packages/llm-client/src/types.ts
//
// Shared types for the LLM client abstraction. Designed against the
// OpenAI Chat Completions API shape because that's the broadest
// common denominator — llama.cpp ships `--api-key` server with the
// same endpoints; Ollama has a `/v1/chat/completions` compat layer;
// OpenAI/Together/DeepSeek/Anthropic-via-proxy all speak this.
//
// Anthropic's native messages API has small shape differences
// (system prompt is top-level, role='assistant' vs 'assistant', etc.)
// — an Anthropic-native adapter would map between shapes. Out of
// scope for v0.0.x.

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  /** Model identifier — opaque to the client; the server decides. */
  model: string
  messages: ChatMessage[]
  /** 0.0–2.0. Default 0.7. */
  temperature?: number
  /** Top-p sampling. Default 1.0. */
  topP?: number
  /** Max tokens to generate. */
  maxTokens?: number
  /** Stop sequences. */
  stop?: string[]
  /**
   * Whether the response should be streamed. Streaming returns an
   * AsyncIterable<ChatStreamChunk>; non-streaming returns a single
   * ChatResponse. Default false (single response).
   */
  stream?: boolean
}

export interface ChatResponse {
  /** The generated assistant message. */
  message: ChatMessage
  /** How the generation terminated. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error'
  /** Token usage, when reported by the server. */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Server-reported model id (may differ from request.model for routers). */
  modelUsed?: string
}

export interface ChatStreamChunk {
  /** Delta text in this chunk. */
  delta: string
  /** Set on the LAST chunk only. */
  finishReason?: ChatResponse['finishReason']
}

// ─── Client interface ───────────────────────────────────────────────

export interface LlmClient {
  /**
   * Send a chat completion request. Throws LlmClientError on transport
   * failure, timeout, or server-side error. The request's `stream`
   * field MUST be false (or omitted) — streaming has its own method.
   */
  chat(req: ChatRequest): Promise<ChatResponse>

  /**
   * Same as chat() but yields chunks. The request's `stream` field
   * MUST be true. Implementations that don't support streaming MAY
   * synthesize chunks from a non-streaming response (degraded).
   */
  chatStream(req: ChatRequest): AsyncIterable<ChatStreamChunk>
}

// ─── Errors ─────────────────────────────────────────────────────────

export type LlmErrorKind =
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'auth'
  | 'unsupported'

export class LlmClientError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmClientError'
  }
}
