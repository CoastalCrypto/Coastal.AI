// packages/llm-client/src/openai-compatible.ts
//
// HTTP adapter for any server that speaks the OpenAI Chat Completions
// API shape:
//   - llama.cpp's `llama-server --port N`
//   - Ollama's `/v1/chat/completions` compat layer
//   - OpenAI itself
//   - Together, DeepSeek, Fireworks, Groq, Anyscale, ...
//
// Streaming uses Server-Sent Events (data: <json>\n\n). Standard
// across all OpenAI-compatible servers.

import type {
  LlmClient, ChatRequest, ChatResponse, ChatStreamChunk,
  ChatMessage,
} from './types.js'
import { LlmClientError } from './types.js'

export interface OpenAICompatibleConfig {
  /** Base URL, e.g. http://localhost:8080 or https://api.openai.com */
  baseUrl: string
  /** Optional API key. Sent as `Authorization: Bearer <key>`. */
  apiKey?: string
  /** Path to the chat-completions endpoint. Default /v1/chat/completions. */
  chatPath?: string
  /** Total request timeout in ms. Default 60000. */
  timeoutMs?: number
  /**
   * Override the fetch implementation. Defaults to globalThis.fetch.
   * Tests pass a stub.
   */
  fetch?: typeof fetch
}

interface OpenAIChoice {
  index: number
  message?: { role: string; content: string }
  delta?: { role?: string; content?: string }
  finish_reason: string | null
}

interface OpenAIChatResponseBody {
  id: string
  model?: string
  choices: OpenAIChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

const DEFAULT_PATH = '/v1/chat/completions'
const DEFAULT_TIMEOUT_MS = 60_000

export function createOpenAICompatibleClient(config: OpenAICompatibleConfig): LlmClient {
  const {
    baseUrl,
    apiKey,
    chatPath = DEFAULT_PATH,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetch: fetchImpl = globalThis.fetch,
  } = config

  if (!fetchImpl) {
    throw new Error('openai-compatible client: no fetch implementation available (Node 18+ or pass config.fetch)')
  }

  const url = baseUrl.replace(/\/$/, '') + chatPath
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  return {
    async chat(req): Promise<ChatResponse> {
      if (req.stream) {
        throw new LlmClientError('invalid_request', 'chat() requires stream:false; use chatStream() for streaming')
      }
      const body = encodeRequest(req, false)
      const res = await fetchWithTimeout(fetchImpl, url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, timeoutMs)
      if (!res.ok) {
        throw await errorFromResponse(res)
      }
      const parsed = await res.json() as OpenAIChatResponseBody
      return decodeResponse(parsed)
    },

    chatStream(req): AsyncIterable<ChatStreamChunk> {
      if (!req.stream) {
        throw new LlmClientError('invalid_request', 'chatStream() requires stream:true')
      }
      const body = encodeRequest(req, true)
      return streamResponse(fetchImpl, url, headers, body, timeoutMs)
    },
  }
}

// ─── encoding ───────────────────────────────────────────────────────

function encodeRequest(req: ChatRequest, stream: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map(m => ({ role: m.role, content: m.content })),
    stream,
  }
  if (req.temperature !== undefined) out.temperature = req.temperature
  if (req.topP !== undefined) out.top_p = req.topP
  if (req.maxTokens !== undefined) out.max_tokens = req.maxTokens
  if (req.stop !== undefined) out.stop = req.stop
  return out
}

function decodeResponse(body: OpenAIChatResponseBody): ChatResponse {
  const choice = body.choices[0]
  if (!choice) {
    throw new LlmClientError('server_error', 'openai-compatible: response had no choices')
  }
  const msg = choice.message
  if (!msg) {
    throw new LlmClientError('server_error', 'openai-compatible: choice missing message field')
  }
  const message: ChatMessage = {
    role: (msg.role as 'assistant') || 'assistant',
    content: msg.content ?? '',
  }
  return {
    message,
    finishReason: normalizeFinishReason(choice.finish_reason),
    usage: body.usage ? {
      promptTokens: body.usage.prompt_tokens,
      completionTokens: body.usage.completion_tokens,
      totalTokens: body.usage.total_tokens,
    } : undefined,
    modelUsed: body.model,
  }
}

function normalizeFinishReason(raw: string | null): ChatResponse['finishReason'] {
  switch (raw) {
    case 'stop': return 'stop'
    case 'length': return 'length'
    case 'content_filter': return 'content_filter'
    case 'tool_calls':
    case 'function_call': return 'tool_calls'
    case null:
    case undefined: return 'stop'
    default: return 'error'
  }
}

// ─── streaming ──────────────────────────────────────────────────────

async function* streamResponse(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
): AsyncIterable<ChatStreamChunk> {
  const res = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs)
  if (!res.ok) throw await errorFromResponse(res)
  if (!res.body) throw new LlmClientError('server_error', 'streaming: response has no body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE frames are separated by \n\n
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const chunk = parseSseFrame(frame)
      if (chunk === 'done') return
      if (chunk !== null) yield chunk
    }
  }
}

function parseSseFrame(frame: string): ChatStreamChunk | null | 'done' {
  // Frame looks like:
  //   data: {"id":"...","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}
  // Or terminator:
  //   data: [DONE]
  const lines = frame.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)
    if (payload.trim() === '[DONE]') return 'done'
    try {
      const parsed = JSON.parse(payload) as OpenAIChatResponseBody
      const choice = parsed.choices?.[0]
      if (!choice) continue
      const delta = choice.delta?.content ?? ''
      return {
        delta,
        finishReason: choice.finish_reason
          ? normalizeFinishReason(choice.finish_reason)
          : undefined,
      }
    } catch {
      continue
    }
  }
  return null
}

// ─── plumbing ───────────────────────────────────────────────────────

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new LlmClientError('timeout', `request exceeded ${timeoutMs}ms`, err)
    }
    throw new LlmClientError('network', `network error: ${(err as Error).message}`, err)
  } finally {
    clearTimeout(timer)
  }
}

async function errorFromResponse(res: Response): Promise<LlmClientError> {
  const text = await res.text().catch(() => '')
  const kind = res.status === 429 ? 'rate_limit'
    : res.status === 401 || res.status === 403 ? 'auth'
    : res.status >= 400 && res.status < 500 ? 'invalid_request'
    : 'server_error'
  return new LlmClientError(kind, `HTTP ${res.status}: ${text.slice(0, 200)}`, undefined, res.status)
}
