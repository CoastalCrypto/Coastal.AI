import { randomUUID } from 'node:crypto'
import type { ChatMessage, OllamaToolSchema } from '../agents/session.js'
import type { ToolCall } from '../agents/types.js'

export type { ChatMessage } from '../agents/session.js'

export interface LocalChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
}

export class OllamaClient {
  constructor(private config: { baseUrl: string }) {}

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { models: Array<{ name: string }> }
    return data.models.map((m) => m.name)
  }

  async chat(model: string, messages: LocalChatMessage[]): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, keep_alive: -1 }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { message: LocalChatMessage }
    return data.message.content
  }

  async *chatStream(model: string, messages: LocalChatMessage[]): AsyncGenerator<string> {
    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, keep_alive: -1 }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) throw new Error(`Ollama stream error ${res.status}: ${await res.text()}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
          if (chunk.message?.content) yield chunk.message.content
        } catch { /* skip malformed lines */ }
      }
    }
  }

  async chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: OllamaToolSchema[],
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, stream: false, keep_alive: -1 }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
    const data = await res.json() as {
      message: {
        role: string
        content: string | null
        tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
      } | undefined
    }
    const msg = data.message
    if (!msg) throw new Error('Ollama returned no message in response')
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
      id: randomUUID(),
      name: tc.function.name,
      args: tc.function.arguments ?? {},
    }))
    return { content: msg.content ?? '', toolCalls }
  }
}
