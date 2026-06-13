import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { ALL_TOOLS } from '../tools/registry'
import { createShell } from '../platform/shell'
import { makeUpdatePlanTool, type PlanItem } from './plan-tool'

// Does flash actually adopt update_plan from the tool description alone
// (no system-prompt nudge)? Real API, gated:
//   DEEPSEEK_SMOKE_KEY=sk-... pnpm -F @vibeseek/core test -t "plan adoption"
const key = process.env.DEEPSEEK_SMOKE_KEY

describe('plan adoption smoke', () => {
  it.skipIf(!key)(
    'multi-step task produces update_plan calls and finishes',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vibeseek-plan-'))
      const updates: PlanItem[][] = []
      try {
        const registry = new ToolRegistry([
          ...ALL_TOOLS,
          makeUpdatePlanTool((items) => updates.push(items)),
        ])
        const context = new SessionContext({
          systemPrompt: SYSTEM_PROMPT,
          tools: registry.defs(),
          contextMessage: 'Empty project folder. Test run.',
        })
        const loop = new AgentLoop({
          streamer: new ProviderClient({ baseUrl: 'https://api.deepseek.com', apiKey: key! }),
          registry,
          context,
          toolContext: { cwd: dir, shell: createShell() },
          model: 'deepseek-v4-flash',
          thinking: 'off',
          maxIterations: 15,
        })
        const events: string[] = []
        for await (const ev of loop.run(
          'Three-step task: 1) create notes.txt containing "alpha", 2) create todo.txt containing "beta", 3) create done.txt containing "gamma". Do them in order.'
        )) {
          events.push(ev.type)
        }
        console.log('[plan] update_plan calls:', updates.length)
        if (updates.length > 0) console.log('[plan] last:', JSON.stringify(updates.at(-1)))
        expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
        expect(existsSync(join(dir, 'done.txt'))).toBe(true)
        // The adoption question: at least one plan update during a 3-step task.
        expect(updates.length).toBeGreaterThan(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000
  )
})
