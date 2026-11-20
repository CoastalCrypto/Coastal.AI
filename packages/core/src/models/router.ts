// packages/core/src/models/router.ts
import { OllamaClient, type LocalChatMessage } from './ollama.js'
import { VllmClient } from './vllm.js'
import { AirLLMClient } from './airllm.js'
import { OpenAICompatibleClient, type InferenceClient } from './openai-compat.js'
import { AnthropicClient, isAnthropicModel } from './anthropic.js'
import { CascadeRouter } from '../routing/cascade.js'
import type { RouteDecision } from '../routing/types.js'
import type { ChatMessage, OllamaToolSchema } from '../agents/session.js'
import type { ToolCall } from '../agents/types.js'
import { loadConfig } from '../config.js'

export type { InferenceClient } from './openai-compat.js'

export interface RouterConfig {
  ollamaUrl: string
  vllmUrl?: string
  airllmUrl?: string
  defaultModel: string
  /** When set, model names starting with "claude-" route to Anthropic's
   *  native API directly, bypassing the vLLM/AirLLM/Ollama cascade below —
   *  see models/anthropic.ts. Defaults to config.anthropicApiKey. */
  anthropicApiKey?: string
}

export interface ChatOptions {
  model?: string
}

export class ModelRouter {
  ollama: OllamaClient
  vllm: VllmClient
  airllm: AirLLMClient
  cascade: CascadeRouter
  private anthropic?: AnthropicClient
  private vllmAvailable: boolean | null = null
  private airllmAvailable = false

  constructor(private config: RouterConfig) {
    this.ollama = new OllamaClient({ baseUrl: config.ollamaUrl })
    this.vllm = new VllmClient(config.vllmUrl ?? 'http://localhost:8000')
    this.airllm = new AirLLMClient(config.airllmUrl ?? 'http://localhost:8002')
    const appConfig = loadConfig()
    const anthropicApiKey = config.anthropicApiKey ?? appConfig.anthropicApiKey
    if (anthropicApiKey) this.anthropic = new AnthropicClient({ apiKey: anthropicApiKey })
    this.cascade = new CascadeRouter({
      ollamaUrl: config.ollamaUrl,
      dataDir: appConfig.dataDir,
      routerConfidence: appConfig.routerConfidence,
      tinyRouterModel: appConfig.tinyRouterModel,
      quantRouterModel: appConfig.quantRouterModel,
      vramBudgetGb: appConfig.vramBudgetGb,
    })
  }

  /** Create an ad-hoc OpenAI-compatible client (e.g. for per-agent model overrides). */
  createCompatClient(baseUrl: string, apiKey?: string): InferenceClient {
    return new OpenAICompatibleClient({ baseUrl, apiKey })
  }

  /**
   * Resolves the backend for one specific model name. Anthropic models
   * (see isAnthropicModel) go straight to the native Anthropic client,
   * independent of whatever the vLLM/AirLLM/Ollama cascade below has
   * probed — Anthropic is never a fallback target for a local model name
   * and vice versa, so there's no ambiguity to cache across calls.
   */
  private async resolveClient(model: string): Promise<InferenceClient> {
    if (isAnthropicModel(model)) {
      if (!this.anthropic) {
        throw new Error(`Model "${model}" looks like an Anthropic model but no API key is configured (set ANTHROPIC_API_KEY).`)
      }
      return this.anthropic
    }
    return this.inferenceClient()
  }

  /** Lazy probe: checks vLLM → AirLLM → Ollama once, caches result. */
  private async inferenceClient(): Promise<InferenceClient> {
    if (this.vllmAvailable === null) {
      this.vllmAvailable = await this.vllm.isAvailable()
      if (!this.vllmAvailable) {
        this.airllmAvailable = await this.airllm.isAvailable()
      }
      const backend = this.vllmAvailable ? 'vLLM (GPU)' : this.airllmAvailable ? 'AirLLM (layer-stream)' : 'Ollama (CPU)'
      console.log(`[model-router] inference backend: ${backend}`)
    }
    if (this.vllmAvailable) return this.vllm
    if (this.airllmAvailable) return this.airllm
    return this.ollama
  }

  async chat(
    messages: LocalChatMessage[],
    options?: ChatOptions,
  ): Promise<{ reply: string; decision: RouteDecision }> {
    const lastMessage = messages[messages.length - 1].content
    const decision = await this.cascade.route(lastMessage)

    const candidates = options?.model
      ? [options.model]
      : [decision.model, ...decision.fallbackModels]

    let lastErr: unknown
    for (const model of candidates) {
      try {
        const client = await this.resolveClient(model)
        const reply = await client.chat(model, messages)
        return { reply, decision: { ...decision, model } }
      } catch (err) {
        lastErr = err
        console.warn(`[router] model ${model} failed, trying next fallback`)
      }
    }
    throw lastErr ?? new Error('All candidate models failed')
  }

  async chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: OllamaToolSchema[],
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    const client = await this.resolveClient(model)
    return client.chatWithTools(model, messages, tools)
  }

  async *chatStream(model: string, messages: LocalChatMessage[]): AsyncGenerator<string> {
    const client = await this.resolveClient(model)
    yield* client.chatStream(model, messages)
  }

  async listModels(): Promise<string[]> {
    return this.ollama.listModels()
  }

  close(): void {
    this.cascade.close()
  }
}
