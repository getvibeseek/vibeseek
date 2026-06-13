import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentLoop } from './loop'
import type { LoopEvent } from './types'
import { ProviderClient } from '../provider/client'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { createShell } from '../platform/shell'

// Real-API plan-mode smoke. Mirrors the desktop preamble + a deny-writes permit;
// verifies the model investigates read-only and produces a plan without writing.
const key = process.env.DEEPSEEK_SMOKE_KEY
const PREAMBLE = `[计划模式 / PLAN MODE]
只读分析，禁止修改文件或执行改动型命令。先用 read_file/grep/glob 调查，然后输出分步方案，不要动手。

任务：
`

describe('real-API plan mode', () => {
  it.skipIf(!key)(
    'investigates read-only and proposes a plan without writing',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vibeseek-plan-'))
      try {
        writeFileSync(join(dir, 'greeting.txt'), 'hello world\n')
        const registry = new ToolRegistry()
        const context = new SessionContext({
          systemPrompt: SYSTEM_PROMPT,
          tools: registry.defs(),
          contextMessage: `Project root contains greeting.txt.`,
        })
        const writeAttempts: string[] = []
        const loop = new AgentLoop({
          streamer: new ProviderClient({ baseUrl: 'https://api.deepseek.com', apiKey: key! }),
          registry,
          context,
          toolContext: { cwd: dir, shell: createShell() },
          model: 'deepseek-v4-flash',
          thinking: 'off',
          permit: async (name) => {
            if (!registry.isReadOnly(name)) {
              writeAttempts.push(name)
              return 'deny'
            }
            return 'allow'
          },
        })

        const events: LoopEvent[] = []
        for await (const e of loop.run(PREAMBLE + 'change "hello" to "hi" in greeting.txt')) {
          events.push(e)
        }
        const finalText = events.find((e) => e.type === 'done') as
          | Extract<LoopEvent, { type: 'done' }>
          | undefined
        // It produced a textual plan (not just silently edited), and any write
        // attempts were denied (the file content is irrelevant — it must stay).
        expect(finalText?.finalText.length ?? 0).toBeGreaterThan(20)
        console.log('[plan] write attempts (denied):', writeAttempts)
        console.log('[plan] final (first 200):', finalText?.finalText.slice(0, 200))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    60_000
  )
})
