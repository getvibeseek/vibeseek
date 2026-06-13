import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentLoop } from './loop'
import type { LoopEvent } from './types'
import { ProviderClient } from '../provider/client'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { createShell } from '../platform/shell'

// Real-API smoke. Gated on DEEPSEEK_SMOKE_KEY so normal `pnpm test` never spends
// money or hits the network. Run with:
//   DEEPSEEK_SMOKE_KEY=sk-... pnpm -F @vibeseek/core test -t smoke
const key = process.env.DEEPSEEK_SMOKE_KEY

describe('real-API smoke', () => {
  it.skipIf(!key)(
    'runs a real edit task end-to-end',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vibeseek-smoke-'))
      try {
        writeFileSync(join(dir, 'greeting.txt'), 'hello world\n')
        const registry = new ToolRegistry()
        const context = new SessionContext({
          systemPrompt: SYSTEM_PROMPT,
          tools: registry.defs(),
          contextMessage: `Project root contains greeting.txt. Today is a test run.`,
        })
        const loop = new AgentLoop({
          streamer: new ProviderClient({ baseUrl: 'https://api.deepseek.com', apiKey: key! }),
          registry,
          context,
          toolContext: { cwd: dir, shell: createShell() },
          model: 'deepseek-v4-flash',
          thinking: 'off',
        })

        const events: LoopEvent[] = []
        for await (const e of loop.run(
          'In greeting.txt, change the word "hello" to "hi" using edit_file. Then stop.'
        )) {
          events.push(e)
        }

        const done = events.find((e) => e.type === 'done')
        expect(done).toBeTruthy()
        // The full pipeline produced real usage (streaming + usage capture worked).
        expect(loop.sessionUsage.promptTokens).toBeGreaterThan(0)
        console.log(
          '[smoke] file now:',
          JSON.stringify(readFileSync(join(dir, 'greeting.txt'), 'utf8'))
        )
        console.log('[smoke] usage:', loop.sessionUsage, 'hitRate:', loop.sessionHitRate)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    60_000
  )
})
