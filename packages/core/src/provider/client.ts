import {
  type ChatRequest,
  type StreamEvent,
  type ToolCall,
  type TurnResult,
  type Usage,
  EMPTY_USAGE,
  InsufficientBalanceError,
  ProviderError,
} from './types'
import { messagesToOpenAI, toolsToOpenAI } from './openai-format'
import { parseToolArguments } from '../loop/fc'

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  maxRetries?: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface RawDelta {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    function?: { name?: string; arguments?: string }
  }>
}

interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

export class ProviderClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRetries: number

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.fetchImpl = config.fetchImpl ?? fetch
    this.sleep = config.sleepImpl ?? defaultSleep
    this.maxRetries = config.maxRetries ?? 3
  }

  /** Stream a chat completion. Yields text/reasoning deltas then a `done`. */
  async *stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const start = Date.now()
    const { res, retries } = await this.connectWithRetry(req, signal)
    for await (const ev of this.parseSse(res, signal)) {
      if (ev.type === 'done') ev.result.meta = { durationMs: Date.now() - start, retries }
      yield ev
    }
  }

  private buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: messagesToOpenAI(req.messages),
      stream: true,
      stream_options: { include_usage: true },
    }
    if (req.tools?.length) body.tools = toolsToOpenAI(req.tools)
    if (req.maxTokens) body.max_tokens = req.maxTokens
    if (req.temperature !== undefined) body.temperature = req.temperature
    // Thinking: high/max map straight through; off omits it. DeepSeek V4 has
    // thinking on by default — disabling cleanly needs real-API verification.
    if (req.thinking && req.thinking !== 'off') body.reasoning_effort = req.thinking
    return body
  }

  private async connectWithRetry(
    req: ChatRequest,
    signal?: AbortSignal
  ): Promise<{ res: Response; retries: number }> {
    const body = JSON.stringify(this.buildBody(req))
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body,
          signal,
        })
      } catch (err) {
        // Network error — retry unless aborted.
        if (signal?.aborted) throw err
        lastErr = err
        if (attempt < this.maxRetries) await this.sleep(backoffMs(attempt))
        continue
      }

      if (res.status === 402) throw new InsufficientBalanceError()
      if (res.ok) return { res, retries: attempt }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ProviderError(`HTTP ${res.status}`, res.status)
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt))
          continue
        }
      }
      // Non-retryable (4xx other than 402/429).
      throw new ProviderError(`HTTP ${res.status}: ${await safeText(res)}`, res.status)
    }
    throw lastErr instanceof Error ? lastErr : new ProviderError('request failed')
  }

  private async *parseSse(res: Response, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (!res.body) throw new ProviderError('no response body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    let buffer = ''
    let text = ''
    let reasoning = ''
    let finishReason = ''
    let usage: Usage = { ...EMPTY_USAGE }
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep the trailing partial line
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          let chunk: {
            choices?: Array<{ delta?: RawDelta; finish_reason?: string | null }>
            usage?: RawUsage
          }
          try {
            chunk = JSON.parse(data)
          } catch {
            continue // skip malformed keepalive lines
          }

          if (chunk.usage) usage = parseUsage(chunk.usage)
          const choice = chunk.choices?.[0]
          if (choice?.finish_reason) finishReason = choice.finish_reason
          const delta = choice?.delta
          if (!delta) continue

          if (delta.reasoning_content) {
            reasoning += delta.reasoning_content
            yield { type: 'reasoning', delta: delta.reasoning_content }
          }
          if (delta.content) {
            text += delta.content
            yield { type: 'text', delta: delta.content }
          }
          for (const tc of delta.tool_calls ?? []) {
            const acc = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name = tc.function.name
            if (tc.function?.arguments) acc.args += tc.function.arguments
            toolAcc.set(tc.index, acc)
          }
        }
        if (signal?.aborted) break
      }
    } finally {
      reader.releaseLock()
    }

    const toolCalls: ToolCall[] = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, acc]) => ({ id: acc.id, name: acc.name, input: parseToolArguments(acc.args) }))

    const result: TurnResult = { text, reasoning, toolCalls, usage, finishReason }
    yield { type: 'done', result }
  }
}

function parseUsage(u: RawUsage): Usage {
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    cacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
    cacheMissTokens: u.prompt_cache_miss_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  }
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt
  return base + Math.floor(Math.random() * 250)
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200)
  } catch {
    return ''
  }
}
