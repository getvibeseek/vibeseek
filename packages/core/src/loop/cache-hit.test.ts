import { describe, it, expect } from 'vitest'
import { ProviderClient } from '../provider/client'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { turnHitRate } from '../meter/hit-rate'
import type { StreamEvent, Usage } from '../provider/types'

// Real-API cache-hit verification. Gated on DEEPSEEK_SMOKE_KEY.
// Sends N short turns in ONE stable context per model and records the per-turn
// hit rate — from turn 2 the stable prefix (system + tools + history) should hit.
//   DEEPSEEK_SMOKE_KEY=sk-... pnpm -F @vibeseek/core exec vitest run src/loop/cache-hit.test.ts
const key = process.env.DEEPSEEK_SMOKE_KEY
const TURNS = 4
const MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']

async function drainUsage(
  gen: AsyncGenerator<StreamEvent>
): Promise<{ usage: Usage; text: string }> {
  let usage: Usage | null = null
  let text = ''
  for await (const ev of gen) {
    if (ev.type === 'text') text += ev.delta
    if (ev.type === 'done') usage = ev.result.usage
  }
  if (!usage) throw new Error('no usage in stream')
  return { usage, text }
}

describe('real-API cache hit rate (both models)', () => {
  it.skipIf(!key)(
    'turn 2+ hits the cached prefix on flash and pro',
    async () => {
      const registry = new ToolRegistry()
      for (const model of MODELS) {
        const client = new ProviderClient({ baseUrl: 'https://api.deepseek.com', apiKey: key! })
        const ctx = new SessionContext({
          systemPrompt: SYSTEM_PROMPT,
          tools: registry.defs(),
          contextMessage:
            'Project root: /demo. Cache probe session. Reply with one short sentence only; never call tools.',
        })
        const rates: number[] = []
        for (let turn = 1; turn <= TURNS; turn++) {
          ctx.append({
            role: 'user',
            content: [{ type: 'text', text: `Probe turn ${turn}: say OK and the turn number.` }],
          })
          const { usage, text } = await drainUsage(
            client.stream({ model, messages: ctx.build(), tools: registry.defs(), thinking: 'off' })
          )
          ctx.append({ role: 'assistant', content: [{ type: 'text', text }] })
          const rate = turnHitRate(usage)
          rates.push(rate)
          console.log(
            `[cache] ${model} turn ${turn}: hit=${usage.cacheHitTokens} miss=${usage.cacheMissTokens} rate=${(rate * 100).toFixed(1)}%`
          )
        }
        // Turn 1 is naturally ~0. From turn 2 the stable prefix must hit hard.
        const later = rates.slice(1)
        const avgLater = later.reduce((a, b) => a + b, 0) / later.length
        console.log(`[cache] ${model} avg(turn2+)=${(avgLater * 100).toFixed(1)}%`)
        expect(avgLater).toBeGreaterThan(0.5)
      }
    },
    180_000
  )
})
