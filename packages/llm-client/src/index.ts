// packages/llm-client/src/index.ts

export type {
  ChatRole, ChatMessage, ChatRequest, ChatResponse, ChatStreamChunk,
  LlmClient, LlmErrorKind,
} from './types.js'

export { LlmClientError } from './types.js'

export {
  createOpenAICompatibleClient,
  type OpenAICompatibleConfig,
} from './openai-compatible.js'

export {
  createCompressingLlmClient,
  type CompressFn,
  type CompressOutcome,
  type CompressOpts,
  type CompressionStat,
} from './compressing-client.js'
