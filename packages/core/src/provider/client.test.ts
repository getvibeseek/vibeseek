import { describe, it, expect, vi } from 'vitest'
import { ProviderClient } from './client'
import { InsufficientBalanceError, ProviderError, type StreamEvent } from './types'

function sse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(stream, { status })
}

async function drain(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const baseReq = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
}

describe('ProviderClient streaming', () => {
  it('assembles text, reasoning, tool calls, and usage', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sse([
          'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":80,"prompt_cache_miss_tokens":20,"completion_tokens_details":{"reasoning_tokens":5}}}\n\n',
          'data: [DONE]\n\n',
        ])
      )
    const client = new ProviderClient({ baseUrl: 'https://x', apiKey: 'sk-x', fetchImpl })
    const events = await drain(client.stream(baseReq))

    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') throw new Error('no done')
    expect(done.result.text).toBe('hello')
    expect(done.result.reasoning).toBe('think')
    expect(done.result.finishReason).toBe('tool_calls')
    expect(done.result.toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', input: { path: 'a.txt' } },
    ])
    expect(done.result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      cacheHitTokens: 80,
      cacheMissTokens: 20,
      reasoningTokens: 5,
    })
    // streamed text deltas were emitted in order
    expect(
      events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)
    ).toEqual(['hel', 'lo'])
  })

  it('retries on 429 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse([], 429))
      .mockResolvedValueOnce(sse([], 429))
      .mockResolvedValueOnce(
        sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n'])
      )
    const client = new ProviderClient({
      baseUrl: 'https://x',
      apiKey: 'sk-x',
      fetchImpl,
      sleepImpl: async () => {},
    })
    const events = await drain(client.stream(baseReq))
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const done = events.at(-1)
    expect(done?.type === 'done' && done.result.text).toBe('ok')
    // meta records the retry chain for the api-*.jsonl log
    expect(done?.type === 'done' && done.result.meta?.retries).toBe(2)
  })

  it('bubbles 402 as InsufficientBalanceError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([], 402))
    const client = new ProviderClient({ baseUrl: 'https://x', apiKey: 'sk-x', fetchImpl })
    await expect(drain(client.stream(baseReq))).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it('throws ProviderError on non-retryable 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([], 400))
    const client = new ProviderClient({ baseUrl: 'https://x', apiKey: 'sk-x', fetchImpl })
    await expect(drain(client.stream(baseReq))).rejects.toBeInstanceOf(ProviderError)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // no retry
  })

  it('sends reasoning_effort for high but omits it for off', async () => {
    const bodies: string[] = []
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      bodies.push(init.body as string)
      return Promise.resolve(sse(['data: [DONE]\n\n']))
    })
    const client = new ProviderClient({ baseUrl: 'https://x', apiKey: 'sk-x', fetchImpl })
    await drain(client.stream({ ...baseReq, thinking: 'high' }))
    await drain(client.stream({ ...baseReq, thinking: 'off' }))
    expect(JSON.parse(bodies[0]).reasoning_effort).toBe('high')
    expect(JSON.parse(bodies[1]).reasoning_effort).toBeUndefined()
  })
})
