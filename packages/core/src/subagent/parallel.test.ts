import { describe, it, expect } from 'vitest'
import { AgentLoop } from '../loop/loop'
import type { ChatStreamer } from '../loop/types'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry, ALL_TOOLS } from '../tools/registry'
import { createShell } from '../platform/shell'
import { makeSubagentTool } from './subagent'
import { EMPTY_USAGE, type StreamEvent, type TurnResult, type ToolCall } from '../provider/types'

const turn = (toolCalls: ToolCall[] = [], text = ''): TurnResult => ({
  text,
  reasoning: '',
  toolCalls,
  usage: { ...EMPTY_USAGE },
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
})

class FakeStreamer implements ChatStreamer {
  private calls = 0
  constructor(private readonly turns: TurnResult[]) {}
  async *stream(): AsyncGenerator<StreamEvent> {
    const t = this.turns[this.calls++] ?? turn([], '(end)')
    yield { type: 'done', result: t }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('parallel sub-agents', () => {
  it('several dispatch_subagent calls in ONE turn run concurrently', async () => {
    // Each fake sub-agent takes 120ms; three in one assistant turn must finish
    // well under 3×120ms (they are read-only → Promise.all batch in the loop).
    let inFlight = 0
    let maxInFlight = 0
    const subTool = makeSubagentTool(async (task) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await sleep(120)
      inFlight--
      return `done: ${task}`
    })
    const registry = new ToolRegistry([...ALL_TOOLS, subTool])
    const context = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: registry.defs(),
      contextMessage: 'ctx',
    })
    const loop = new AgentLoop({
      streamer: new FakeStreamer([
        turn([
          { id: 'a', name: 'dispatch_subagent', input: { task: 'map auth flow' } },
          { id: 'b', name: 'dispatch_subagent', input: { task: 'list TODOs' } },
          { id: 'c', name: 'dispatch_subagent', input: { task: 'find dead code' } },
        ]),
        turn([], 'all three reported'),
      ]),
      registry,
      context,
      toolContext: { cwd: '.', shell: createShell() },
      model: 'deepseek-v4-flash',
    })

    const t0 = Date.now()
    const results: string[] = []
    for await (const ev of loop.run('survey the repo')) {
      if (ev.type === 'tool_end') results.push(ev.result.content)
    }
    const wall = Date.now() - t0

    expect(results).toHaveLength(3)
    expect(results).toContain('done: list TODOs')
    expect(maxInFlight).toBe(3) // genuinely concurrent, not interleaved-serial
    expect(wall).toBeLessThan(300) // 3×120ms serial would be ≥360ms
  })
})
