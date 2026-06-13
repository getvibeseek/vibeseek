// Internal message format uses content blocks so vision/multimodal can
// land later without reworking storage/serialization.

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string } // base64; future vision
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  role: Role
  content: ContentBlock[]
}

/** A JSON-schema object describing a tool's parameters. */
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ThinkingEffort = 'off' | 'high' | 'max'

export interface ChatRequest {
  model: string
  messages: Message[]
  tools?: ToolDef[]
  thinking?: ThinkingEffort
  maxTokens?: number
  temperature?: number
}

/** Token usage for one request. cacheHit/Miss are DeepSeek's native fields. */
export interface Usage {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  reasoningTokens: number
}

export const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  reasoningTokens: 0,
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** Streamed events. The terminal `done` carries the fully assembled turn. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'done'; result: TurnResult }

export interface RequestMeta {
  durationMs: number
  retries: number
}

export interface TurnResult {
  text: string
  reasoning: string
  toolCalls: ToolCall[]
  usage: Usage
  finishReason: string
  meta?: RequestMeta
}

/** 402: account out of balance — bubbled distinctly so the UI can guide topup. */
export class InsufficientBalanceError extends Error {
  constructor() {
    super('insufficient balance (402)')
    this.name = 'InsufficientBalanceError'
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
