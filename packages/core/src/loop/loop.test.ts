import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentLoop } from './loop'
import type { ChatStreamer, LoopEvent } from './types'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { createShell } from '../platform/shell'
import {
  EMPTY_USAGE,
  type StreamEvent,
  type TurnResult,
  type ToolCall,
  type Usage,
} from '../provider/types'

function turn(opts: { text?: string; toolCalls?: ToolCall[]; usage?: Partial<Usage> }): TurnResult {
  return {
    text: opts.text ?? '',
    reasoning: '',
    toolCalls: opts.toolCalls ?? [],
    usage: { ...EMPTY_USAGE, ...opts.usage },
    finishReason: opts.toolCalls?.length ? 'tool_calls' : 'stop',
  }
}

/** Scripted streamer: returns queued turns in order. */
class FakeStreamer implements ChatStreamer {
  calls = 0
  constructor(private readonly turns: TurnResult[]) {}
  async *stream(): AsyncGenerator<StreamEvent> {
    const t = this.turns[this.calls++] ?? turn({ text: '(end)' })
    if (t.text) yield { type: 'text', delta: t.text }
    yield { type: 'done', result: t }
  }
}

function makeLoop(streamer: ChatStreamer, cwd: string): AgentLoop {
  const registry = new ToolRegistry()
  const context = new SessionContext({
    systemPrompt: SYSTEM_PROMPT,
    tools: registry.defs(),
    contextMessage: 'ctx',
  })
  return new AgentLoop({
    streamer,
    registry,
    context,
    toolContext: { cwd, shell: createShell() },
    model: 'deepseek-v4-flash',
  })
}

async function drain(gen: AsyncGenerator<LoopEvent>): Promise<LoopEvent[]> {
  const out: LoopEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'vibeseek-loop-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('AgentLoop', () => {
  it('completes a three-round tool task (read -> edit -> final)', async () => {
    writeFileSync(join(dir, 'a.ts'), 'const x = 1\n')
    const streamer = new FakeStreamer([
      turn({
        toolCalls: [{ id: '1', name: 'read_file', input: { path: 'a.ts' } }],
        usage: { cacheMissTokens: 100 },
      }),
      turn({
        toolCalls: [
          {
            id: '2',
            name: 'edit_file',
            input: { path: 'a.ts', old_str: 'const x = 1', new_str: 'const x = 2' },
          },
        ],
        usage: { cacheHitTokens: 90, cacheMissTokens: 10 },
      }),
      turn({ text: 'done', usage: { cacheHitTokens: 95, cacheMissTokens: 5 } }),
    ])
    const loop = makeLoop(streamer, dir)
    const events = await drain(loop.run('change x to 2'))

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toContain('const x = 2')
    const done = events.at(-1)
    expect(done?.type === 'done' && done.finalText).toBe('done')
    const toolEnds = events.filter((e) => e.type === 'tool_end')
    expect(toolEnds.map((e) => (e as { name: string }).name)).toEqual(['read_file', 'edit_file'])
    // session hit rate across the three turns: hit 0+90+95=185, miss 100+10+5=115
    expect(loop.sessionHitRate).toBeCloseTo(185 / 300)
  })

  it('suppresses the third identical tool call', async () => {
    const dup: ToolCall = { id: 'd', name: 'shell', input: { command: 'echo hi' } }
    const streamer = new FakeStreamer([
      turn({ toolCalls: [{ ...dup, id: 'a' }] }),
      turn({ toolCalls: [{ ...dup, id: 'b' }] }),
      turn({ toolCalls: [{ ...dup, id: 'c' }] }),
      turn({ text: 'stop' }),
    ])
    const loop = makeLoop(streamer, dir)
    const events = await drain(loop.run('loop forever'))
    const ends = events.filter((e) => e.type === 'tool_end') as Array<{
      result: { content: string }
    }>
    expect(ends[2].result.content).toContain('suppressed')
  })

  it('runs two loops concurrently with independent usage attribution', async () => {
    const a = makeLoop(
      new FakeStreamer([turn({ text: 'A', usage: { cacheHitTokens: 10, cacheMissTokens: 0 } })]),
      dir
    )
    const b = makeLoop(
      new FakeStreamer([turn({ text: 'B', usage: { cacheHitTokens: 0, cacheMissTokens: 50 } })]),
      dir
    )
    await Promise.all([drain(a.run('a')), drain(b.run('b'))])
    expect(a.sessionUsage.cacheHitTokens).toBe(10)
    expect(a.sessionUsage.cacheMissTokens).toBe(0)
    expect(b.sessionUsage.cacheHitTokens).toBe(0)
    expect(b.sessionUsage.cacheMissTokens).toBe(50)
  })

  it('stops promptly when the signal is aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const loop = makeLoop(new FakeStreamer([turn({ text: 'should not run' })]), dir)
    const events = await drain(loop.run('x', ctrl.signal))
    const done = events.at(-1)
    expect(done?.type === 'done' && done.aborted).toBe(true)
  })
})
